import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPlanner } from "./parent-lines.mjs";

const FENCE = "```";
const PLAIN = "## Design\n\nFollows the parent #10.\n";

function list(items) {
  return `## Child issues\n${items.map((item, i) => `${i + 1}. ${item}`).join("\n")}\n`;
}

function fixture({ fifteenAlsoUnder30 = false } = {}) {
  const issues = [
    { number: 30, state: "CLOSED", body: list(fifteenAlsoUnder30 ? ["#14 d", "#15 e", "#16 f"] : ["#14 d", "#16 f"]) },
    { number: 22, state: "OPEN", body: "## Design\n\nparent: #10\n" },
    { number: 21, state: "OPEN", body: "## Design\n\nParent: 10\n" },
    { number: 20, state: "OPEN", body: "## Design\n\nThe parent's open workspace is reused.\n" },
    { number: 19, state: "OPEN", body: `## Design\n\n${FENCE}\nParent: #10\n${FENCE}\n\nFollows.\n` },
    { number: 18, state: "OPEN", body: "## Background\n\nNo design here.\n" },
    { number: 17, state: "CLOSED", body: PLAIN },
    { number: 16, state: "OPEN", body: "## Design\n\nFollows #30.\n" },
    { number: 15, state: "OPEN", body: "## Design\n\nParent: #99\n" },
    { number: 14, state: "OPEN", body: PLAIN },
    { number: 13, state: "OPEN", body: PLAIN },
    { number: 12, state: "OPEN", body: PLAIN },
    { number: 11, state: "OPEN", body: "## Design\n\nParent: #10\n\nFollows the parent.\n" },
    {
      number: 10,
      state: "OPEN",
      body: list([
        "#11 a",
        "#12 b",
        "#13 c",
        "#14 d",
        "#15 e",
        "#17 g",
        "#18 h",
        "#19 i",
        "#21 j",
        "#22 k",
      ]),
    },
  ];
  return async (args) => {
    if (args[0] === "issue") return JSON.stringify(issues);
    return JSON.stringify([
      { number: 50, closingIssuesReferences: [{ number: 13 }] },
    ]);
  };
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "parent-lines-"));
}

test("prepares bodies and reports every skip in ascending order", async () => {
  const dir = tmp();
  const result = await createPlanner({ gh: fixture() }).plan(dir);
  assert.equal(result.ok, true);
  assert.deepEqual(result.lines, [
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
  ]);
  assert.deepEqual(fs.readdirSync(dir).sort(), [
    "issue-12.md",
    "issue-16.md",
    "issue-19.md",
  ]);
  assert.equal(
    fs.readFileSync(path.join(dir, "issue-12.md"), "utf8"),
    "## Design\n\nParent: #10\n\nFollows the parent #10.\n",
  );
  assert.equal(
    fs.readFileSync(path.join(dir, "issue-19.md"), "utf8"),
    `## Design\n\nParent: #10\n\n${FENCE}\nParent: #10\n${FENCE}\n\nFollows.\n`,
  );
});

test("names more than one parent before any other cause", async () => {
  const result = await createPlanner({
    gh: fixture({ fifteenAlsoUnder30: true }),
  }).plan(tmp());
  assert.ok(
    result.lines.includes("skip #15: listed by more than one parent: #10, #30"),
  );
});

test("writes nothing when the open PR listing fails", async () => {
  const dir = tmp();
  const ok = fixture();
  const gh = async (args) => {
    if (args[0] === "pr") throw new Error("gh: could not connect");
    return ok(args);
  };
  const result = await createPlanner({ gh }).plan(dir);
  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, [
    "failed: could not read GitHub: gh: could not connect",
  ]);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("stops at the first body that cannot be written", async () => {
  const root = tmp();
  const dir = path.join(root, "out");
  fs.mkdirSync(path.join(dir, "issue-12.md"), { recursive: true });
  const result = await createPlanner({ gh: fixture() }).plan(dir);
  assert.equal(result.ok, false);
  assert.equal(result.lines.length, 1);
  assert.ok(
    result.lines[0].startsWith(
      `failed: could not write ${path.join(dir, "issue-12.md")}: EISDIR`,
    ),
  );
  assert.deepEqual(fs.readdirSync(dir), ["issue-12.md"]);
});

test("keeps CRLF endings and recognises a correct Parent line in a CRLF body", async () => {
  const issues = [
    { number: 10, state: "OPEN", body: list(["#11 a", "#12 b"]) },
    {
      number: 11,
      state: "OPEN",
      body: "## Design\r\n\r\nParent: #10\r\n\r\nFollows.\r\n",
    },
    { number: 12, state: "OPEN", body: "## Design\r\n\r\nFollows.\r\n" },
  ];
  const gh = async (args) =>
    JSON.stringify(args[0] === "issue" ? issues : []);
  const dir = tmp();
  const result = await createPlanner({ gh }).plan(dir);
  assert.deepEqual(result.lines, [
    "write #12: Parent: #10",
    "ok: 1 to write, 0 skipped",
  ]);
  assert.deepEqual(fs.readdirSync(dir), ["issue-12.md"]);
  assert.equal(
    fs.readFileSync(path.join(dir, "issue-12.md"), "utf8"),
    "## Design\r\n\r\nParent: #10\r\n\r\nFollows.\r\n",
  );
});
