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

const BASE_CHILD = `## Request

Request for the test.

## Design

Design for the test.

## Decided
- None

## Verification
- V1: Run \`runs/example.ts\`. It passes when it prints ok.

## To Implementer
- Files / modules: none
`;

const BASE_PARENT = `## Request

Request for the test.

## Design

Design for the test.

## Decided
- Retry count: 3

## Child issues
1. #12 First child
`;

async function runCheck(body) {
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
const withVerification = (items) =>
  BASE_CHILD.replace(
    "- V1: Run `runs/example.ts`. It passes when it prints ok.",
    items,
  );

test("prints ok and exits 0 for a child with every section in place", async () => {
  const { code, stdout } = await runCheck(BASE_CHILD);

  assert.equal(code, 0);
  assert.equal(stdout, "body.md: ok\n");
});

test("prints ok and exits 0 for a parent with every section in place", async () => {
  const { code, stdout } = await runCheck(BASE_PARENT);

  assert.equal(code, 0);
  assert.equal(stdout, "body.md: ok\n");
});

test("reports a body that is neither a child nor a parent and exits 1", async () => {
  const { code, stderr } = await runCheck("## Request\n\nSomething.\n");

  assert.equal(code, 1);
  assert.equal(
    stderr,
    'body.md:1: neither "## To Implementer" nor "## Child issues": not an architect issue\n',
  );
});

test("reports a missing decided section and exits 1", async () => {
  const body = BASE_CHILD.replace("## Decided\n- None\n\n", "");

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.equal(stderr, 'body.md:1: missing section "## Decided"\n');
});

test("reports a decided section with no items and exits 1", async () => {
  const body = BASE_CHILD.replace("## Decided\n- None\n", "## Decided\n");

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.equal(stderr, 'body.md:9: "Decided" needs items, or "- None"\n');
});

test("reports a verification section placed after the implementer section and exits 1", async () => {
  const body = BASE_CHILD.replace(
    "## Verification\n- V1: Run `runs/example.ts`. It passes when it prints ok.\n\n",
    "",
  ).concat("\n## Verification\n- None\n");

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.equal(stderr, 'body.md:12: "## To Implementer" is out of order\n');
});

test("prints ok and exits 0 when verification is a bare None", async () => {
  const { code, stdout } = await runCheck(withVerification("- None"));

  assert.equal(code, 0);
  assert.equal(stdout, "body.md: ok\n");
});

test("prints ok and exits 0 when verification gives a reason instead of an entry", async () => {
  const { code, stdout } = await runCheck(
    withVerification("- None: no entry reaches the audio device"),
  );

  assert.equal(code, 0);
  assert.equal(stdout, "body.md: ok\n");
});

test("reports None next to another verification item and exits 1", async () => {
  const { code, stderr } = await runCheck(
    withVerification("- None\n- V1: Run `runs/example.ts`. It prints ok."),
  );

  assert.equal(code, 1);
  assert.equal(stderr, 'body.md:13: "None" must be the only item in "Verification"\n');
});

test("reports a verification item with the wrong shape and exits 1", async () => {
  const { code, stderr } = await runCheck(withVerification("- Run the example."));

  assert.equal(code, 1);
  assert.equal(
    stderr,
    'body.md:13: check is not "V<n>: <entry> ..." or "None: <reason>"\n',
  );
});

test("reports a verification item with no entry in backticks and exits 1", async () => {
  const { code, stderr } = await runCheck(
    withVerification("- V1: Run the example. It prints ok."),
  );

  assert.equal(code, 1);
  assert.equal(stderr, "body.md:13: V1 names no entry in backticks\n");
});

test("reports a repeated verification id, naming the line it was already used on, and exits 1", async () => {
  const { code, stderr } = await runCheck(
    withVerification(
      "- V1: Run `runs/a.ts`. It prints a.\n- V1: Run `runs/b.ts`. It prints b.",
    ),
  );

  assert.equal(code, 1);
  assert.equal(stderr, "body.md:14: V1 is already used on line 13\n");
});

test("reports a parent issue that carries a parent line and exits 1", async () => {
  const body = BASE_PARENT.replace("Design for the test.", "Parent: #3");

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.equal(stderr, "body.md:7: a Parent line in a parent issue\n");
});

const PARENT_LINE_ERROR = 'body.md:7: Parent line is not "Parent: #<n>"\n';

test("prints ok and exits 0 for one parent line in the design section", async () => {
  const { code, stdout } = await runCheck(withDesign("Parent: #12"));

  assert.equal(code, 0);
  assert.equal(stdout, "body.md: ok\n");
});

test("reports a parent line without the issue mark and exits 1", async () => {
  const { code, stderr } = await runCheck(withDesign("Parent: 12"));

  assert.equal(code, 1);
  assert.equal(stderr, PARENT_LINE_ERROR);
});

test("reports a parent line in lower case and exits 1", async () => {
  const { code, stderr } = await runCheck(withDesign("parent: #12"));

  assert.equal(code, 1);
  assert.equal(stderr, PARENT_LINE_ERROR);
});

test("reports a parent line that starts with spaces and exits 1", async () => {
  const { code, stderr } = await runCheck(withDesign("  Parent: #12"));

  assert.equal(code, 1);
  assert.equal(stderr, PARENT_LINE_ERROR);
});

test("reports the second parent line in the design section and exits 1", async () => {
  const { code, stderr } = await runCheck(withDesign("Parent: #12\nParent: #13"));

  assert.equal(code, 1);
  assert.equal(stderr, 'body.md:8: more than one Parent line in "## Design"\n');
});

test("prints ok and exits 0 for a parent line inside a code fence", async () => {
  const { code, stdout } = await runCheck(withDesign("```\nParent: 12\n```"));

  assert.equal(code, 0);
  assert.equal(stdout, "body.md: ok\n");
});

test("prints ok and exits 0 for a parent line outside the design section", async () => {
  const body = BASE_CHILD.replace("Request for the test.", "Parent: 12");

  const { code, stdout } = await runCheck(body);

  assert.equal(code, 0);
  assert.equal(stdout, "body.md: ok\n");
});

test("prints ok and exits 0 for prose that uses the word parent", async () => {
  const { code, stdout } = await runCheck(
    withDesign("The parent's open workspace is reused."),
  );

  assert.equal(code, 0);
  assert.equal(stdout, "body.md: ok\n");
});
