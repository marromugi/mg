import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const ISSUE_LIST = [
  "issue",
  "list",
  "--state",
  "all",
  "--limit",
  "1000",
  "--json",
  "number,state,body",
];
const PR_LIST = [
  "pr",
  "list",
  "--state",
  "open",
  "--limit",
  "1000",
  "--json",
  "number,closingIssuesReferences",
];

const firstLine = (error) =>
  String(error?.message ?? error).split("\n")[0];

const isFence = (line) => line.startsWith("```");

/** Line range of the section under `heading`, up to the next `## `. */
function section(lines, heading) {
  const start = lines.findIndex((line) => line.trimEnd() === heading);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function childrenOf(body) {
  const lines = body.split(/\r?\n/);
  const range = section(lines, "## Child issues");
  if (!range) return [];
  const numbers = [];
  for (const line of lines.slice(range.start + 1, range.end)) {
    const match = /^\d+\.\s+#(\d+)/.exec(line);
    if (match) numbers.push(Number(match[1]));
  }
  return numbers;
}

/** Parent lines of a Design section, outside code fences. */
function parentLines(lines, range) {
  const found = [];
  let inFence = false;
  for (const line of lines.slice(range.start + 1, range.end)) {
    if (isFence(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^\s*parent\s*:/i.test(line)) found.push(line);
  }
  return found;
}

function withParentLine(lines, range, parent, eol) {
  const out = [...lines];
  let at = -1;
  for (let i = range.start + 1; i < range.end; i++) {
    if (lines[i].trim() !== "") {
      at = i;
      break;
    }
  }
  if (at === -1) {
    if (lines[range.start + 1] !== "") out.splice(range.start + 1, 0, "");
    at = range.start + 2;
  }
  out.splice(at, 0, `Parent: #${parent}`, "");
  return out.join(eol);
}

export function createPlanner({ gh }) {
  async function plan(dir) {
    let issues;
    let prs;
    try {
      issues = JSON.parse(await gh(ISSUE_LIST));
      prs = JSON.parse(await gh(PR_LIST));
    } catch (error) {
      return {
        ok: false,
        lines: [`failed: could not read GitHub: ${firstLine(error)}`],
      };
    }

    const listers = new Map();
    for (const issue of issues) {
      for (const child of new Set(childrenOf(issue.body ?? ""))) {
        if (!listers.has(child)) listers.set(child, []);
        listers.get(child).push(issue.number);
      }
    }
    const closedByPr = new Map();
    for (const pr of prs) {
      for (const ref of pr.closingIssuesReferences ?? []) {
        if (!closedByPr.has(ref.number)) closedByPr.set(ref.number, pr.number);
      }
    }

    const writes = [];
    const lines = [];
    const open = issues
      .filter((issue) => issue.state.toUpperCase() === "OPEN")
      .sort((a, b) => a.number - b.number);
    for (const issue of open) {
      const n = issue.number;
      const parents = (listers.get(n) ?? []).sort((a, b) => a - b);
      if (parents.length === 0) continue;
      if (parents.length > 1) {
        lines.push(
          `skip #${n}: listed by more than one parent: ${parents
            .map((p) => `#${p}`)
            .join(", ")}`,
        );
        continue;
      }
      const [parent] = parents;
      const bodyLines = (issue.body ?? "").split(/\r?\n/);
      const design = section(bodyLines, "## Design");
      if (!design) {
        lines.push(`skip #${n}: no Design section`);
        continue;
      }
      const found = parentLines(bodyLines, design);
      if (found.length === 1 && found[0] === `Parent: #${parent}`) continue;
      if (found.length > 0) {
        lines.push(
          `skip #${n}: its Parent line does not match #${parent}, which lists it`,
        );
        continue;
      }
      if (closedByPr.has(n)) {
        lines.push(`skip #${n}: open PR #${closedByPr.get(n)}`);
        continue;
      }
      const eol = (issue.body ?? "").includes("\r\n") ? "\r\n" : "\n";
      writes.push({
        n,
        parent,
        body: withParentLine(bodyLines, design, parent, eol),
      });
    }

    const skipped = lines.length;
    for (const { n, parent, body } of writes) {
      const file = `${dir}${dir.endsWith("/") ? "" : "/"}issue-${n}.md`;
      try {
        await fs.writeFile(file, body);
      } catch (error) {
        return {
          ok: false,
          lines: [`failed: could not write ${file}: ${firstLine(error)}`],
        };
      }
      lines.push(`write #${n}: Parent: #${parent}`);
    }

    const issueNumber = (line) => Number(/#(\d+)/.exec(line)[1]);
    lines.sort((a, b) => issueNumber(a) - issueNumber(b));
    lines.push(`ok: ${writes.length} to write, ${skipped} skipped`);
    return { ok: true, lines };
  }
  return { plan };
}

function realGh(bin) {
  return async (args) => {
    try {
      const { stdout } = await execFileAsync(bin, args, {
        maxBuffer: 256 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      const stderr = String(error.stderr ?? "").trim();
      throw new Error(stderr || error.message);
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--dir");
  const dir = at === -1 ? undefined : process.argv[at + 1];
  if (!dir || process.argv.length !== 4) {
    console.error("usage: parent-lines.mjs --dir <dir>");
    process.exit(2);
  }
  const gh = realGh(process.env.PARENT_LINES_GH_BIN || "gh");
  const { ok, lines } = await createPlanner({ gh }).plan(dir);
  console.log(lines.join("\n"));
  process.exit(ok ? 0 : 1);
}
