import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createGuard } from "./issue-guard.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("./issue-guard.mjs", import.meta.url));

const PARENT_BODY =
  "## 設計\n\n決定の節です。\n\n## 子 issue\n\n1. #11 a\n2. #12 b（#11）\n3. #13 c\n";
const CHILD_BODY = "## 設計\n\n親は #10 です。\n";
const STANDALONE_BODY = "## 設計\n\nこれは独立の issue です。\n";

function createFixture() {
  const issues = new Map([
    [10, { number: 10, state: "OPEN", stateReason: null, body: PARENT_BODY }],
    [11, { number: 11, state: "OPEN", stateReason: null, body: CHILD_BODY }],
    [12, { number: 12, state: "OPEN", stateReason: null, body: CHILD_BODY }],
    [13, { number: 13, state: "OPEN", stateReason: null, body: CHILD_BODY }],
    [20, { number: 20, state: "OPEN", stateReason: null, body: STANDALONE_BODY }],
  ]);
  const comments = new Map();

  const gh = async (args) => {
    if (args[0] === "issue" && args[1] === "view") {
      const n = Number(args[2]);
      const issue = issues.get(n);
      if (!issue) throw new Error(`no such issue #${n}`);
      return JSON.stringify(issue);
    }
    if (args[0] === "issue" && args[1] === "list") {
      return JSON.stringify([...issues.values()]);
    }
    if (args[0] === "api") {
      const match = /issues\/(\d+)\/comments/.exec(args[1]);
      const n = Number(match[1]);
      return JSON.stringify(comments.get(n) ?? []);
    }
    throw new Error(`unexpected gh args: ${args.join(" ")}`);
  };

  return { issues, comments, gh };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "issue-guard-"));
}

const human = () => ({ user: { type: "User" } });
const bot = () => ({ user: { type: "Bot" } });

test("refuses to start a closed issue, naming its state and closed reason", async () => {
  const { issues, gh } = createFixture();
  const closed = issues.get(11);
  closed.state = "CLOSED";
  closed.stateReason = "NOT_PLANNED";
  const guard = createGuard({ gh });

  const result = await guard.check(11);

  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, ["refused: issue #11 is not open (CLOSED, NOT_PLANNED)"]);
});

test("confirms start is possible and prints the parent's other children in body order", async () => {
  const { issues, gh } = createFixture();
  const done = issues.get(11);
  done.state = "CLOSED";
  done.stateReason = "COMPLETED";
  const guard = createGuard({ gh });

  const result = await guard.check(12);

  assert.equal(result.ok, true);
  assert.deepEqual(result.lines, [
    "ok: issue #12 can start",
    "parent: #10",
    "child #11: CLOSED COMPLETED",
    "child #13: OPEN",
  ]);
});

test("confirms start is possible for an issue with no parent, printing none", async () => {
  const { gh } = createFixture();
  const guard = createGuard({ gh });

  const result = await guard.check(20);

  assert.equal(result.ok, true);
  assert.deepEqual(result.lines, ["ok: issue #20 can start", "parent: none"]);
});

test("refuses when more than one issue lists it as a child", async () => {
  const { issues, gh } = createFixture();
  issues.set(30, {
    number: 30,
    state: "OPEN",
    stateReason: null,
    body: "## 子 issue\n\n1. #12 b\n",
  });
  const guard = createGuard({ gh });

  const result = await guard.check(12);

  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, [
    "refused: issue #12 is listed by more than one parent: #10, #30",
  ]);
});

test("refuses when its design section names a parent that lists it nowhere", async () => {
  const { issues, gh } = createFixture();
  issues.get(10).body = PARENT_BODY.replace("3. #13 c\n", "");
  const guard = createGuard({ gh });

  const result = await guard.check(13);

  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, [
    "refused: issue #13 mentions a parent but no issue lists it under 子 issue",
  ]);
});

test("refuses when a sibling child is closed as not planned", async () => {
  const { issues, gh } = createFixture();
  const refused = issues.get(11);
  refused.state = "CLOSED";
  refused.stateReason = "NOT_PLANNED";
  const guard = createGuard({ gh });

  const result = await guard.check(13);

  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, [
    "refused: parent #10 lists #11, which is closed as not planned",
  ]);
});

test("names the parent even when the parent issue itself is closed", async () => {
  const { issues, gh } = createFixture();
  issues.get(10).state = "CLOSED";
  issues.get(10).stateReason = "COMPLETED";
  const done = issues.get(11);
  done.state = "CLOSED";
  done.stateReason = "COMPLETED";
  const guard = createGuard({ gh });

  const result = await guard.check(12);

  assert.equal(result.ok, true);
  assert.equal(result.lines[1], "parent: #10");
});

test("writes a snapshot capturing the issue and its parent's body, and writes nothing when it cannot start", async () => {
  const { gh } = createFixture();
  const guard = createGuard({ gh });
  const dir = tempDir();

  const written = await guard.snapshot(12, dir);
  assert.equal(written.ok, true);
  const savedPath = path.join(dir, "issue-12.json");
  assert.equal(fs.existsSync(savedPath), true);
  const saved = JSON.parse(fs.readFileSync(savedPath, "utf8"));
  assert.equal(saved.body, CHILD_BODY);
  assert.equal(saved.parent.number, 10);
  assert.equal(saved.parent.body, PARENT_BODY);

  const { issues: refusedIssues, gh: refusedGh } = createFixture();
  const refusedIssue = refusedIssues.get(11);
  refusedIssue.state = "CLOSED";
  refusedIssue.stateReason = "NOT_PLANNED";
  const refusedGuard = createGuard({ gh: refusedGh });

  const refused = await refusedGuard.snapshot(11, dir);
  assert.equal(refused.ok, false);
  assert.equal(fs.existsSync(path.join(dir, "issue-11.json")), false);
});

test("refuses to compare when no snapshot exists", async () => {
  const { gh } = createFixture();
  const guard = createGuard({ gh });
  const dir = tempDir();

  const result = await guard.verify(12, dir);

  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, ["refused: no snapshot for issue #12"]);
});

test("confirms an unchanged issue still matches its snapshot", async () => {
  const { gh } = createFixture();
  const guard = createGuard({ gh });
  const dir = tempDir();
  await guard.snapshot(12, dir);

  const result = await guard.verify(12, dir);

  assert.equal(result.ok, true);
  assert.deepEqual(result.lines, ["ok: issue #12 matches its snapshot"]);
});

test("refuses when the issue's body changed since the snapshot", async () => {
  const { issues, gh } = createFixture();
  const guard = createGuard({ gh });
  const dir = tempDir();
  await guard.snapshot(12, dir);
  issues.get(12).body = CHILD_BODY + " ";

  const result = await guard.verify(12, dir);

  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, ["refused: issue #12 body changed since the snapshot"]);
});

test("refuses when the parent's body changed since the snapshot", async () => {
  const { issues, gh } = createFixture();
  const guard = createGuard({ gh });
  const dir = tempDir();
  await guard.snapshot(12, dir);
  issues.get(10).body = PARENT_BODY.replace("決定の節です。", "決定の節を書き換えました。");

  const result = await guard.verify(12, dir);

  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, ["refused: parent #10 body changed since the snapshot"]);
});

test("refuses when the issue closed since the snapshot", async () => {
  const { issues, gh } = createFixture();
  const guard = createGuard({ gh });
  const dir = tempDir();
  await guard.snapshot(12, dir);
  const closed = issues.get(12);
  closed.state = "CLOSED";
  closed.stateReason = "COMPLETED";

  const result = await guard.verify(12, dir);

  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, ["refused: issue #12 is not open (CLOSED, COMPLETED)"]);
});

test("allows a sibling child that went from open to closed completed since the snapshot", async () => {
  const { issues, gh } = createFixture();
  const guard = createGuard({ gh });
  const dir = tempDir();
  await guard.snapshot(12, dir);
  const finished = issues.get(13);
  finished.state = "CLOSED";
  finished.stateReason = "COMPLETED";

  const result = await guard.verify(12, dir);

  assert.equal(result.ok, true);
});

test("refuses when a sibling child changed state in a direction other than open to closed completed", async () => {
  const { issues, gh } = createFixture();
  const reopening = issues.get(11);
  reopening.state = "CLOSED";
  reopening.stateReason = "COMPLETED";
  const guard = createGuard({ gh });
  const dir = tempDir();
  await guard.snapshot(12, dir);
  reopening.state = "OPEN";
  reopening.stateReason = null;

  const result = await guard.verify(12, dir);

  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, [
    "refused: child #11 of parent #10 changed from CLOSED COMPLETED to OPEN",
  ]);
});

test("refuses when the human comment count increased since the snapshot", async () => {
  const { comments, gh } = createFixture();
  comments.set(12, [human()]);
  const guard = createGuard({ gh });
  const dir = tempDir();
  await guard.snapshot(12, dir);
  comments.set(12, [human(), human()]);

  const result = await guard.verify(12, dir);

  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, [
    "refused: issue #12 human comment count changed since the snapshot (1 to 2)",
  ]);
});

test("refuses when the human comment count decreased since the snapshot", async () => {
  const { comments, gh } = createFixture();
  comments.set(12, [human(), human()]);
  const guard = createGuard({ gh });
  const dir = tempDir();
  await guard.snapshot(12, dir);
  comments.set(12, [human()]);

  const result = await guard.verify(12, dir);

  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, [
    "refused: issue #12 human comment count changed since the snapshot (2 to 1)",
  ]);
});

test("does not count bot comments toward the human comment count", async () => {
  const { comments, gh } = createFixture();
  const guard = createGuard({ gh });
  const dir = tempDir();
  await guard.snapshot(12, dir);
  comments.set(12, [bot(), bot()]);

  const result = await guard.verify(12, dir);

  assert.equal(result.ok, true);
});

test("re-checks on compare and refuses when the issue's parent no longer lists it", async () => {
  const { issues, gh } = createFixture();
  const guard = createGuard({ gh });
  const dir = tempDir();
  await guard.snapshot(13, dir);
  issues.get(10).body = PARENT_BODY.replace("3. #13 c\n", "");

  const result = await guard.verify(13, dir);

  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, [
    "refused: issue #13 mentions a parent but no issue lists it under 子 issue",
  ]);
});

test("re-checks on compare and refuses when more than one issue lists it as a child", async () => {
  const { issues, gh } = createFixture();
  const guard = createGuard({ gh });
  const dir = tempDir();
  await guard.snapshot(12, dir);
  issues.set(30, {
    number: 30,
    state: "OPEN",
    stateReason: null,
    body: "## 子 issue\n\n1. #12 b\n",
  });

  const result = await guard.verify(12, dir);

  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, [
    "refused: issue #12 is listed by more than one parent: #10, #30",
  ]);
});

test("re-checks on compare and refuses when a sibling child is closed as not planned", async () => {
  const { issues, gh } = createFixture();
  const guard = createGuard({ gh });
  const dir = tempDir();
  await guard.snapshot(13, dir);
  const refused = issues.get(11);
  refused.state = "CLOSED";
  refused.stateReason = "NOT_PLANNED";

  const result = await guard.verify(13, dir);

  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, [
    "refused: parent #10 lists #11, which is closed as not planned",
  ]);
});

test("refuses when the issue gained a parent since the snapshot", async () => {
  const { issues, gh } = createFixture();
  const guard = createGuard({ gh });
  const dir = tempDir();
  await guard.snapshot(20, dir);
  issues.get(10).body = PARENT_BODY.replace("3. #13 c\n", "3. #13 c\n4. #20 d\n");

  const result = await guard.verify(20, dir);

  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, [
    "refused: issue #20 parent changed since the snapshot (none to #10)",
  ]);
});

test("confirms start, snapshot, and compare all succeed while a sibling child stays open", async () => {
  const { gh } = createFixture();
  const guard = createGuard({ gh });
  const dir = tempDir();

  const checked = await guard.check(12);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.lines, [
    "ok: issue #12 can start",
    "parent: #10",
    "child #11: OPEN",
    "child #13: OPEN",
  ]);

  const written = await guard.snapshot(12, dir);
  assert.equal(written.ok, true);
  const compared = await guard.verify(12, dir);
  assert.equal(compared.ok, true);
});

test("reports a GitHub read failure as a refusal carrying the error message", async () => {
  const gh = async () => {
    throw new Error("gh: could not connect");
  };
  const guard = createGuard({ gh });

  const result = await guard.check(12);

  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, ["refused: could not read GitHub: gh: could not connect"]);
});

test("the command line entry point maps the guard's result to the process exit code and prints its lines", async () => {
  const dir = tempDir();
  const fakeGhPath = path.join(dir, "fake-gh.mjs");
  fs.writeFileSync(
    fakeGhPath,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "const issues = {",
      '  10: { number: 10, state: "OPEN", stateReason: null, body: "## 設計\\n\\n決定の節です。\\n\\n## 子 issue\\n\\n1. #11 a\\n2. #12 b\\n3. #13 c\\n" },',
      '  11: { number: 11, state: "CLOSED", stateReason: "COMPLETED", body: "## 設計\\n\\n親は #10 です。\\n" },',
      '  12: { number: 12, state: "OPEN", stateReason: null, body: "## 設計\\n\\n親は #10 です。\\n" },',
      '  13: { number: 13, state: "OPEN", stateReason: null, body: "## 設計\\n\\n親は #10 です。\\n" },',
      "};",
      'if (args[0] === "issue" && args[1] === "view") {',
      "  process.stdout.write(JSON.stringify(issues[Number(args[2])]));",
      '} else if (args[0] === "issue" && args[1] === "list") {',
      "  process.stdout.write(JSON.stringify(Object.values(issues)));",
      '} else if (args[0] === "api") {',
      "  process.stdout.write(JSON.stringify([]));",
      "} else {",
      "  process.exit(1);",
      "}",
      "",
    ].join("\n"),
  );
  fs.chmodSync(fakeGhPath, 0o755);
  const env = { ...process.env, ISSUE_GUARD_GH_BIN: fakeGhPath };

  const ok = await execFileAsync(process.execPath, [SCRIPT, "check", "12"], { env });
  assert.deepEqual(ok.stdout.trim().split("\n"), [
    "ok: issue #12 can start",
    "parent: #10",
    "child #11: CLOSED COMPLETED",
    "child #13: OPEN",
  ]);

  await assert.rejects(
    execFileAsync(process.execPath, [SCRIPT, "check", "11"], { env }),
    (err) => {
      assert.equal(err.code, 1);
      assert.deepEqual(err.stdout.trim().split("\n"), [
        "refused: issue #11 is not open (CLOSED, COMPLETED)",
      ]);
      return true;
    },
  );
});
