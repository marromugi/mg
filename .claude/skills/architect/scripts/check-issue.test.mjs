import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("./check-issue.mjs", import.meta.url));

const BASE_CHILD = `## Background

Background for the test.

## Design

Design for the test.

## Changes

- Changes for the test.

## Constraints

### Behaviour
- B1: Behaviour for the test.

### Structure
- None

### Direction
- None

## Cases
- C1 [B1]: Case for the test.

## Verification
- V1 [B1]: Run \`runs/example.ts\`. It passes when it prints ok.

## To Implementer
- Files / modules: none
`;

const PARENT_WITHOUT_CONFIRMED = `## Decision

Decision for the test.

## Behaviour changes
- None

## Place in the whole

Place for the test.

## Reasons
- Principle 1: Reason for the test.

## Rejected shapes
- None

## Trade-offs
- None
`;

function tempFile(name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-issue-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

async function runCheck(body, name = "body.md") {
  const file = tempFile(name, body);
  try {
    const result = await execFileAsync(process.execPath, [SCRIPT, file]);
    return { code: 0, stdout: result.stdout, stderr: result.stderr, file };
  } catch (err) {
    return { code: err.code, stdout: err.stdout, stderr: err.stderr, file };
  }
}

test("reports a missing confirmation section and exits 1", async () => {
  const body = BASE_CHILD.replace(
    /## Verification\n[\s\S]*?\n\n## To Implementer/,
    "## To Implementer",
  );

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(stderr, /missing section "## Verification"/);
});

test("reports a confirmation section placed before the cases and exits 1", async () => {
  const confirmationBlock = `## Verification
- V1 [B1]: Run \`runs/example.ts\`. It passes when it prints ok.

`;
  const body = BASE_CHILD.replace(
    /## Verification\n[\s\S]*?\n\n(?=## To Implementer)/,
    "",
  ).replace("## Cases", `${confirmationBlock}## Cases`);

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(stderr, /"## Verification" is out of order/);
});

test("reports a decision record missing the confirmed-facts section and exits 1", async () => {
  const { code, stderr } = await runCheck(PARENT_WITHOUT_CONFIRMED);

  assert.equal(code, 1);
  assert.match(stderr, /missing section "## Confirmed facts"/);
});

test("reports a bare confirmation entry as wrong when there are no behaviour constraints, and exits 1", async () => {
  const body = BASE_CHILD.replace("- B1: Behaviour for the test.", "- None")
    .replace("- C1 [B1]: Case for the test.", "- None")
    .replace(
      "- V1 [B1]: Run `runs/example.ts`. It passes when it prints ok.",
      "- None: no entry reaches it",
    );

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(
    stderr,
    /"Verification" must be "- None" when there are no behaviour constraints/,
  );
});

test("reports a bare confirmation entry as wrong when there are behaviour constraints, and exits 1", async () => {
  const body = BASE_CHILD.replace(
    "- V1 [B1]: Run `runs/example.ts`. It passes when it prints ok.",
    "- None",
  );

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(
    stderr,
    /"Verification" needs "V<n>" items or "None: <reason>" when there are behaviour constraints/,
  );
});

test("reports a confirmation entry with the wrong shape and exits 1", async () => {
  const body = BASE_CHILD.replace(
    "- V1 [B1]: Run `runs/example.ts`. It passes when it prints ok.",
    "- Run runs/example.ts",
  );

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(stderr, /check is not "V<n>: <entry> \.\.\." or "None: <reason>"/);
});

test("reports a confirmation entry naming an undeclared behaviour constraint, and exits 1", async () => {
  const body = BASE_CHILD.replace("V1 [B1]:", "V1 [B9]:");

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(stderr, /V1 names B9, which is not declared/);
});

test("reports a confirmation entry naming a case instead of a behaviour constraint, and exits 1", async () => {
  const body = BASE_CHILD.replace("V1 [B1]:", "V1 [C1]:");

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(stderr, /V1 names C1: only B ids are named by checks/);
});

test("reports a confirmation entry with no entry in backticks, and exits 1", async () => {
  const body = BASE_CHILD.replace(
    "Run `runs/example.ts`",
    "Run runs/example.ts",
  );

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(stderr, /V1 names no entry in backticks/);
});

test("reports a repeated confirmation id, naming the line it was already used on, and exits 1", async () => {
  const body = BASE_CHILD.replace(
    "- V1 [B1]: Run `runs/example.ts`. It passes when it prints ok.\n",
    "- V1 [B1]: Run `runs/example.ts`. It passes when it prints ok.\n- V1 [B1]: Run `runs/example.ts` again.\n",
  );

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(stderr, /V1 is already used on line/);
});

test("prints ok and exits 0 for a body with every section in place", async () => {
  const { code, stdout, file } = await runCheck(BASE_CHILD);

  assert.equal(code, 0);
  assert.equal(stdout, `${file}: ok\n`);
});

test("prints ok and exits 0 when the confirmation entry gives a reason instead of an entry", async () => {
  const body = BASE_CHILD.replace(
    "- V1 [B1]: Run `runs/example.ts`. It passes when it prints ok.",
    "- None: no entry to run. Checked in #12",
  );

  const { code, stdout, file } = await runCheck(body);

  assert.equal(code, 0);
  assert.equal(stdout, `${file}: ok\n`);
});

async function runCheckInFolder(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-issue-"));
  fs.writeFileSync(path.join(dir, "body.md"), body);
  try {
    const result = await execFileAsync(process.execPath, [SCRIPT, "body.md"], {
      cwd: dir,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

const withDesign = (text) => BASE_CHILD.replace("Design for the test.", text);

const PARENT_LINE_ERROR = 'body.md:7: Parent line is not "Parent: #<n>"\n';

test("reports a parent line without the issue mark and exits 1", async () => {
  const { code, stderr } = await runCheckInFolder(withDesign("Parent: 12"));

  assert.equal(code, 1);
  assert.equal(stderr, PARENT_LINE_ERROR);
});

test("reports a parent line in lower case and exits 1", async () => {
  const { code, stderr } = await runCheckInFolder(withDesign("parent: #12"));

  assert.equal(code, 1);
  assert.equal(stderr, PARENT_LINE_ERROR);
});

test("reports a parent line that starts with spaces and exits 1", async () => {
  const { code, stderr } = await runCheckInFolder(withDesign("  Parent: #12"));

  assert.equal(code, 1);
  assert.equal(stderr, PARENT_LINE_ERROR);
});

test("reports the second parent line in the design section and exits 1", async () => {
  const { code, stderr } = await runCheckInFolder(
    withDesign("Parent: #12\nParent: #13"),
  );

  assert.equal(code, 1);
  assert.equal(stderr, 'body.md:8: more than one Parent line in "## Design"\n');
});

test("reports a parent line in a body that holds its own decision record and exits 1", async () => {
  const record = [
    "Decision",
    "Behaviour changes",
    "Place in the whole",
    "Confirmed facts",
    "Reasons",
    "Rejected shapes",
    "Trade-offs",
  ]
    .map((title) => `## ${title}\n- None\n\n`)
    .join("");

  const { code, stderr } = await runCheckInFolder(
    record + withDesign("Parent: #12"),
  );

  assert.equal(code, 1);
  assert.equal(
    stderr,
    "body.md:28: a Parent line in a body that holds its own decision record\n",
  );
});

test("prints ok and exits 0 for one parent line in the design section", async () => {
  const { code, stdout } = await runCheckInFolder(withDesign("Parent: #12"));

  assert.equal(code, 0);
  assert.equal(stdout, "body.md: ok\n");
});

test("prints ok and exits 0 for a parent line inside a code fence", async () => {
  const { code, stdout } = await runCheckInFolder(
    withDesign("```\nParent: 12\n```"),
  );

  assert.equal(code, 0);
  assert.equal(stdout, "body.md: ok\n");
});

test("prints ok and exits 0 for a parent line outside the design section", async () => {
  const body = BASE_CHILD.replace("Background for the test.", "Parent: 12");

  const { code, stdout } = await runCheckInFolder(body);

  assert.equal(code, 0);
  assert.equal(stdout, "body.md: ok\n");
});

test("prints ok and exits 0 for prose that uses the word parent", async () => {
  const { code, stdout } = await runCheckInFolder(
    withDesign("The parent's open workspace is reused."),
  );

  assert.equal(code, 0);
  assert.equal(stdout, "body.md: ok\n");
});
