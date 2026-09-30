import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createPlanner } from "./parent-lines.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("./parent-lines.mjs", import.meta.url));

const FENCE = "```";
const FOLLOWS_PARENT = "## Design\n\nFollows the parent #10.\n";

function listBody(items) {
  const lines = items.map((n, i) => `${i + 1}. #${n} ${String.fromCharCode(97 + i)}`);
  return `## Child issues\n\n${lines.join("\n")}\n`;
}

function fixtureIssues() {
  return [
    { number: 30, state: "CLOSED", body: "## Child issues\n\n1. #14 d\n2. #16 f\n" },
    { number: 22, state: "OPEN", body: "## Design\n\nparent: #10\n" },
    { number: 21, state: "OPEN", body: "## Design\n\nParent: 10\n" },
    { number: 20, state: "OPEN", body: "## Design\n\nThe parent's open workspace is reused.\n" },
    {
      number: 19,
      state: "OPEN",
      body: `## Design\n\n${FENCE}\nParent: #10\n${FENCE}\n\nFollows.\n`,
    },
    { number: 18, state: "OPEN", body: "## Background\n\nNo design here.\n" },
    { number: 17, state: "CLOSED", body: FOLLOWS_PARENT },
    { number: 16, state: "OPEN", body: "## Design\n\nFollows #30.\n" },
    { number: 15, state: "OPEN", body: "## Design\n\nParent: #99\n" },
    { number: 14, state: "OPEN", body: FOLLOWS_PARENT },
    { number: 13, state: "OPEN", body: FOLLOWS_PARENT },
    { number: 12, state: "OPEN", body: FOLLOWS_PARENT },
    { number: 11, state: "OPEN", body: "## Design\n\nParent: #10\n\nFollows the parent.\n" },
    {
      number: 10,
      state: "OPEN",
      body: listBody([11, 12, 13, 14, 15, 17, 18, 19, 21, 22]),
    },
  ];
}

function fakeGh({ issues = fixtureIssues() } = {}) {
  return async (args) => {
    if (args[0] === "issue" && args[1] === "list") return JSON.stringify(issues);
    if (args[0] === "pr" && args[1] === "list") {
      return JSON.stringify([{ number: 50, closingIssuesReferences: [{ number: 13 }] }]);
    }
    throw new Error(`unexpected gh args: ${args.join(" ")}`);
  };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "parent-lines-"));
}

const C1_LINES = [
  "write #12: Parent: #10",
  "skip #13: open PR #50",
  "skip #14: listed by more than one parent: #10, #30",
  "skip #15: its Parent line does not match #10, which lists it",
  "write #16: Parent: #30",
  "skip #18: no Design section",
  "write #19: Parent: #10",
  "skip #21: its Parent line does not match #10, which lists it",
  "skip #22: its Parent line does not match #10, which lists it",
  "ok: 3 to write, 6 skipped",
];

test("writes a line for three issues, skips six, and names each reason", async () => {
  const dir = tempDir();
  const result = await createPlanner({ gh: fakeGh() }).plan(dir);
  assert.equal(result.ok, true);
  assert.deepEqual(result.lines, C1_LINES);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["issue-12.md", "issue-16.md", "issue-19.md"]);
});

test("puts the Parent line and an empty line at the top of Design", async () => {
  const dir = tempDir();
  await createPlanner({ gh: fakeGh() }).plan(dir);
  assert.equal(
    fs.readFileSync(path.join(dir, "issue-12.md"), "utf8"),
    "## Design\n\nParent: #10\n\nFollows the parent #10.\n",
  );
});

test("leaves a fenced Parent line in place and writes a real one above the fence", async () => {
  const dir = tempDir();
  await createPlanner({ gh: fakeGh() }).plan(dir);
  assert.equal(
    fs.readFileSync(path.join(dir, "issue-19.md"), "utf8"),
    `## Design\n\nParent: #10\n\n${FENCE}\nParent: #10\n${FENCE}\n\nFollows.\n`,
  );
});

test("names listing by two parents before a Parent line that does not match", async () => {
  const issues = fixtureIssues().map((issue) =>
    issue.number === 30
      ? { ...issue, body: "## Child issues\n\n1. #14 d\n2. #15 e\n3. #16 f\n" }
      : issue,
  );
  const result = await createPlanner({ gh: fakeGh({ issues }) }).plan(tempDir());
  assert.ok(result.lines.includes("skip #15: listed by more than one parent: #10, #30"));
});

async function runCli(args, env) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [SCRIPT, ...args], { env });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code, stdout: error.stdout };
  }
}

function writeFakeGh(dir, { failPrList }) {
  const file = path.join(dir, "fake-gh.mjs");
  const source = `#!/usr/bin/env node
const issues = ${JSON.stringify(fixtureIssues())};
const args = process.argv.slice(2);
if (args[0] === "issue") process.stdout.write(JSON.stringify(issues));
else if (${failPrList}) { process.stderr.write("gh: could not connect\\n"); process.exit(1); }
else process.stdout.write(JSON.stringify([{ number: 50, closingIssuesReferences: [{ number: 13 }] }]));
`;
  fs.writeFileSync(file, source, { mode: 0o755 });
  return file;
}

test("reports a failed read and writes nothing when the open PR listing fails", async () => {
  const work = tempDir();
  const out = path.join(work, "out");
  fs.mkdirSync(out);
  const gh = writeFakeGh(work, { failPrList: true });
  const result = await runCli(["--dir", out], { ...process.env, PARENT_LINES_GH_BIN: gh });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "failed: could not read GitHub: gh: could not connect\n");
  assert.deepEqual(fs.readdirSync(out), []);
});

test("reports the first failed write and writes no later file", async () => {
  const work = tempDir();
  const out = path.join(work, "out");
  fs.mkdirSync(path.join(out, "issue-12.md"), { recursive: true });
  const gh = writeFakeGh(work, { failPrList: false });
  const result = await runCli(["--dir", out], { ...process.env, PARENT_LINES_GH_BIN: gh });
  assert.equal(result.code, 1);
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith(`failed: could not write ${out}/issue-12.md: EISDIR`));
  assert.deepEqual(fs.readdirSync(out), ["issue-12.md"]);
});
