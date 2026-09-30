#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GH_MAX_BUFFER = 256 * 1024 * 1024;

const HEADING_RE = /^## /;
const CHILDREN_HEADING_RE = /^## Child issues\s*$/;
const DESIGN_HEADING_RE = /^## Design\s*$/;
const CHILD_ITEM_RE = /^\d+\.\s+#(\d+)/;
const PARENT_LINE_RE = /^\s*parent\s*:/i;
const READABLE_PARENT_RE = /^Parent: #(\d+)$/;
const FENCE = "```";

function sectionRange(lines, headingRe) {
  const heading = lines.findIndex((line) => headingRe.test(line));
  if (heading === -1) return null;
  let end = lines.length;
  for (let i = heading + 1; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { heading, end };
}

function parseChildren(body) {
  const lines = body.split("\n");
  const range = sectionRange(lines, CHILDREN_HEADING_RE);
  if (range === null) return [];
  const children = [];
  for (const line of lines.slice(range.heading + 1, range.end)) {
    const m = CHILD_ITEM_RE.exec(line);
    if (m) children.push(Number(m[1]));
  }
  return children;
}

function parentLinesOutsideFences(lines) {
  const found = [];
  let fenced = false;
  for (const line of lines) {
    if (line.startsWith(FENCE)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced && PARENT_LINE_RE.test(line)) found.push(line.replace(/\r$/, ""));
  }
  return found;
}

function withParentLine(body, range, parent) {
  const lines = body.split("\n");
  const first = lines.findIndex(
    (line, i) => i > range.heading && i < range.end && line.trim() !== "",
  );
  if (first !== -1) {
    lines.splice(first, 0, `Parent: #${parent}`, "");
  } else if (range.heading + 1 < range.end) {
    lines.splice(range.heading + 2, 0, `Parent: #${parent}`, "");
  } else {
    lines.splice(range.heading + 1, 0, "", `Parent: #${parent}`, "");
  }
  return lines.join("\n");
}

function firstLine(error) {
  return String(error?.message ?? error).split("\n")[0];
}

export function createPlanner({ gh }) {
  async function plan(dir) {
    let issues;
    let prs;
    try {
      issues = JSON.parse(
        await gh(["issue", "list", "--state", "all", "--limit", "1000", "--json", "number,state,body"]),
      );
      prs = JSON.parse(
        await gh([
          "pr",
          "list",
          "--state",
          "open",
          "--limit",
          "1000",
          "--json",
          "number,closingIssuesReferences",
        ]),
      );
    } catch (error) {
      return {
        ok: false,
        lines: [`failed: could not read GitHub: ${firstLine(error)}`],
      };
    }

    const parents = new Map();
    for (const issue of issues) {
      for (const child of new Set(parseChildren(issue.body ?? ""))) {
        if (!parents.has(child)) parents.set(child, []);
        parents.get(child).push(issue.number);
      }
    }

    const openPr = new Map();
    for (const pr of [...prs].sort((a, b) => a.number - b.number)) {
      for (const ref of pr.closingIssuesReferences ?? []) {
        if (!openPr.has(ref.number)) openPr.set(ref.number, pr.number);
      }
    }

    const lines = [];
    const writes = [];
    let skipped = 0;
    const byNumber = [...issues].sort((a, b) => a.number - b.number);
    for (const issue of byNumber) {
      if (issue.state !== "OPEN" || !parents.has(issue.number)) continue;
      const listers = [...parents.get(issue.number)].sort((a, b) => a - b);
      const skip = (reason) => {
        lines.push(`skip #${issue.number}: ${reason}`);
        skipped++;
      };
      if (listers.length > 1) {
        skip(`listed by more than one parent: ${listers.map((n) => `#${n}`).join(", ")}`);
        continue;
      }
      const [parent] = listers;
      const body = issue.body ?? "";
      const range = sectionRange(body.split("\n"), DESIGN_HEADING_RE);
      if (range === null) {
        skip("no Design section");
        continue;
      }
      const parentLines = parentLinesOutsideFences(
        body.split("\n").slice(range.heading + 1, range.end),
      );
      if (parentLines.length === 0) {
        if (openPr.has(issue.number)) {
          skip(`open PR #${openPr.get(issue.number)}`);
          continue;
        }
        writes.push({ number: issue.number, body: withParentLine(body, range, parent) });
        lines.push(`write #${issue.number}: Parent: #${parent}`);
        continue;
      }
      const declared =
        parentLines.length === 1 ? READABLE_PARENT_RE.exec(parentLines[0]) : null;
      if (declared && Number(declared[1]) === parent) continue;
      skip(`its Parent line does not match #${parent}, which lists it`);
    }

    for (const write of writes) {
      const file = path.join(dir, `issue-${write.number}.md`);
      try {
        fs.writeFileSync(file, write.body);
      } catch (error) {
        return {
          ok: false,
          lines: [`failed: could not write ${file}: ${firstLine(error)}`],
        };
      }
    }

    lines.push(`ok: ${writes.length} to write, ${skipped} skipped`);
    return { ok: true, lines };
  }

  return { plan };
}

function createGh(bin) {
  return async (args) => {
    try {
      const { stdout } = await execFileAsync(bin, args, { maxBuffer: GH_MAX_BUFFER });
      return stdout;
    } catch (error) {
      const stderr = String(error.stderr ?? "").trim();
      throw new Error(stderr === "" ? error.message : stderr);
    }
  };
}

async function main(argv) {
  const at = argv.indexOf("--dir");
  const dir = at === -1 ? undefined : argv[at + 1];
  if (argv.length !== 2 || dir === undefined) {
    console.log("usage: parent-lines.mjs --dir <dir>");
    return 2;
  }
  const gh = createGh(process.env.PARENT_LINES_GH_BIN || "gh");
  const result = await createPlanner({ gh }).plan(dir);
  for (const line of result.lines) console.log(line);
  return result.ok ? 0 : 1;
}

function isMain() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
}

if (isMain()) {
  process.exitCode = await main(process.argv.slice(2));
}
