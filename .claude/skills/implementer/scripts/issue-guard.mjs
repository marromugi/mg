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
const CHILDREN_HEADING_RE = /^## 子 issue\s*$/;
const DESIGN_HEADING_RE = /^## 設計\s*$/;
const CHILD_ITEM_RE = /^\d+\.\s+#(\d+)/;

function section(body, headingRe) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => headingRe.test(line));
  if (start === -1) return null;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

function parseChildren(body) {
  const lines = section(body, CHILDREN_HEADING_RE);
  if (lines === null) return null;
  const children = [];
  for (const line of lines) {
    const m = CHILD_ITEM_RE.exec(line);
    if (m) children.push(Number(m[1]));
  }
  return children;
}

function mentionsParent(body) {
  const lines = section(body, DESIGN_HEADING_RE);
  return lines !== null && lines.join("\n").includes("親");
}

function formatState({ state, stateReason }) {
  return state === "OPEN" ? "OPEN" : `CLOSED ${stateReason}`;
}

function formatParentRef(number) {
  return number === null ? "none" : `#${number}`;
}

function firstNonEmptyLine(text) {
  if (!text) return "";
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "");
  return line ?? "";
}

function parseJsonDocuments(text) {
  const documents = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[" || ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) documents.push(JSON.parse(text.slice(start, i + 1)));
    }
  }
  return documents;
}

async function fetchIssue(gh, n) {
  const stdout = await gh(["issue", "view", String(n), "--json", "number,state,stateReason,body"]);
  return JSON.parse(stdout);
}

async function fetchAllIssues(gh) {
  const stdout = await gh([
    "issue",
    "list",
    "--state",
    "all",
    "--limit",
    "1000",
    "--json",
    "number,state,stateReason,body",
  ]);
  return JSON.parse(stdout);
}

async function countHumanComments(gh, n) {
  const stdout = await gh(["api", `repos/{owner}/{repo}/issues/${n}/comments`, "--paginate"]);
  const comments = parseJsonDocuments(stdout).flat();
  return comments.filter((comment) => comment.user?.type === "User").length;
}

async function resolve(gh, n) {
  const issue = await fetchIssue(gh, n);
  if (issue.state !== "OPEN") {
    return {
      ok: false,
      lines: [`refused: issue #${n} is not open (${issue.state}, ${issue.stateReason})`],
    };
  }

  const all = await fetchAllIssues(gh);
  const parents = [];
  for (const candidate of all) {
    if (candidate.number === n) continue;
    const children = parseChildren(candidate.body);
    if (children !== null && children.includes(n)) parents.push(candidate);
  }

  if (parents.length > 1) {
    const numbers = parents.map((p) => p.number).sort((a, b) => a - b);
    return {
      ok: false,
      lines: [
        `refused: issue #${n} is listed by more than one parent: ${numbers.map((x) => `#${x}`).join(", ")}`,
      ],
    };
  }

  if (parents.length === 0) {
    if (mentionsParent(issue.body)) {
      return {
        ok: false,
        lines: [`refused: issue #${n} mentions a parent but no issue lists it under 子 issue`],
      };
    }
    return { ok: true, issue, parent: null };
  }

  const parentIssue = parents[0];
  const byNumber = new Map(all.map((i) => [i.number, i]));
  const children = [];
  for (const num of parseChildren(parentIssue.body)) {
    if (num === n) continue;
    const child = byNumber.get(num);
    if (!child) {
      return {
        ok: false,
        lines: [`refused: parent #${parentIssue.number} lists #${num}, which could not be read as an issue`],
      };
    }
    children.push({ number: num, state: child.state, stateReason: child.stateReason });
  }

  const notPlanned = children.find((c) => c.state === "CLOSED" && c.stateReason === "NOT_PLANNED");
  if (notPlanned) {
    return {
      ok: false,
      lines: [`refused: parent #${parentIssue.number} lists #${notPlanned.number}, which is closed as not planned`],
    };
  }

  return {
    ok: true,
    issue,
    parent: { number: parentIssue.number, body: parentIssue.body, children },
  };
}

function formatCheckLines(n, resolved) {
  const lines = [`ok: issue #${n} can start`];
  if (resolved.parent === null) {
    lines.push("parent: none");
  } else {
    lines.push(`parent: #${resolved.parent.number}`);
    for (const child of resolved.parent.children) {
      lines.push(`child #${child.number}: ${formatState(child)}`);
    }
  }
  return lines;
}

function ghErrorRefusal(err) {
  const message = firstNonEmptyLine(err.stderr) || firstNonEmptyLine(err.message);
  return { ok: false, lines: [`refused: could not read GitHub: ${message}`] };
}

export function createGuard({ gh }) {
  async function check(n) {
    try {
      const resolved = await resolve(gh, n);
      if (!resolved.ok) return resolved;
      return { ok: true, lines: formatCheckLines(n, resolved) };
    } catch (err) {
      return ghErrorRefusal(err);
    }
  }

  async function snapshot(n, dir) {
    let resolved;
    let humanComments;
    try {
      resolved = await resolve(gh, n);
      if (!resolved.ok) return resolved;
      humanComments = await countHumanComments(gh, n);
    } catch (err) {
      return ghErrorRefusal(err);
    }

    const data = {
      number: n,
      body: resolved.issue.body,
      parent: resolved.parent,
      humanComments,
    };
    try {
      fs.writeFileSync(path.join(dir, `issue-${n}.json`), `${JSON.stringify(data, null, 2)}\n`);
    } catch (err) {
      return { ok: false, lines: [`refused: could not write the snapshot: ${firstNonEmptyLine(err.message)}`] };
    }
    return { ok: true, lines: [`ok: issue #${n} snapshot written`] };
  }

  async function verify(n, dir) {
    let snap;
    try {
      snap = JSON.parse(fs.readFileSync(path.join(dir, `issue-${n}.json`), "utf8"));
    } catch {
      return { ok: false, lines: [`refused: no snapshot for issue #${n}`] };
    }

    let resolved;
    let humanComments;
    try {
      resolved = await resolve(gh, n);
      if (!resolved.ok) return resolved;
      humanComments = await countHumanComments(gh, n);
    } catch (err) {
      return ghErrorRefusal(err);
    }

    const currentParentNumber = resolved.parent === null ? null : resolved.parent.number;
    const snapParentNumber = snap.parent === null ? null : snap.parent.number;
    if (currentParentNumber !== snapParentNumber) {
      return {
        ok: false,
        lines: [
          `refused: issue #${n} parent changed since the snapshot (${formatParentRef(snapParentNumber)} to ${formatParentRef(currentParentNumber)})`,
        ],
      };
    }

    if (resolved.issue.body !== snap.body) {
      return { ok: false, lines: [`refused: issue #${n} body changed since the snapshot`] };
    }

    if (resolved.parent !== null) {
      if (resolved.parent.body !== snap.parent.body) {
        return {
          ok: false,
          lines: [`refused: parent #${resolved.parent.number} body changed since the snapshot`],
        };
      }

      for (let i = 0; i < resolved.parent.children.length; i++) {
        const current = resolved.parent.children[i];
        const was = snap.parent.children[i];
        const unchanged = was.state === current.state && was.stateReason === current.stateReason;
        const completedSince =
          was.state === "OPEN" && current.state === "CLOSED" && current.stateReason === "COMPLETED";
        if (!unchanged && !completedSince) {
          return {
            ok: false,
            lines: [
              `refused: child #${current.number} of parent #${resolved.parent.number} changed from ${formatState(was)} to ${formatState(current)}`,
            ],
          };
        }
      }
    }

    if (humanComments !== snap.humanComments) {
      return {
        ok: false,
        lines: [
          `refused: issue #${n} human comment count changed since the snapshot (${snap.humanComments} to ${humanComments})`,
        ],
      };
    }

    return { ok: true, lines: [`ok: issue #${n} matches its snapshot`] };
  }

  return { check, snapshot, verify };
}

async function main() {
  const [, , cmd, nStr, ...rest] = process.argv;
  const n = Number(nStr);
  const usage = () => {
    console.error("Usage: node issue-guard.mjs <check|snapshot|verify> <N> [--dir <dir>]");
    process.exit(2);
  };

  if (!["check", "snapshot", "verify"].includes(cmd) || !Number.isInteger(n) || n <= 0) usage();

  let dir;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--dir") dir = rest[i + 1];
  }
  if ((cmd === "snapshot" || cmd === "verify") && !dir) usage();

  const ghBin = process.env.ISSUE_GUARD_GH_BIN ?? "gh";
  const gh = async (args) => {
    const { stdout } = await execFileAsync(ghBin, args, { maxBuffer: GH_MAX_BUFFER });
    return stdout;
  };

  const guard = createGuard({ gh });
  const result = cmd === "check" ? await guard.check(n) : cmd === "snapshot" ? await guard.snapshot(n, dir) : await guard.verify(n, dir);

  for (const line of result.lines) console.log(line);
  process.exit(result.ok ? 0 : 1);
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
}

if (isEntryPoint()) {
  main().catch((err) => {
    console.log(`refused: unexpected error: ${firstNonEmptyLine(err?.message ?? String(err))}`);
    process.exit(1);
  });
}
