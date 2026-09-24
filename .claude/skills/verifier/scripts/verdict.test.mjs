import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("./verdict.mjs", import.meta.url));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "verdict-"));
}

// Writes a fake `gh` onto PATH. It answers `pr view` with a fixed head sha,
// records every call to `logPath`, and answers `api` calls either with
// success or with the failure the test asked for via GH_API_FAIL.
function writeFakeGh(dir, logPath) {
  const fakeGhPath = path.join(dir, "gh");
  fs.writeFileSync(
    fakeGhPath,
    [
      "#!/usr/bin/env node",
      "import fs from 'node:fs';",
      "const args = process.argv.slice(2);",
      `fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + '\\n');`,
      "if (args[0] === 'pr' && args[1] === 'view') {",
      "  process.stdout.write(JSON.stringify({ headRefOid: 'abc123' }));",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'api') {",
      "  if (process.env.GH_API_FAIL) {",
      "    process.stderr.write('HTTP 404\\n');",
      "    process.exit(1);",
      "  }",
      "  process.stdout.write('{}');",
      "  process.exit(0);",
      "}",
      "process.exit(1);",
      "",
    ].join("\n"),
  );
  fs.chmodSync(fakeGhPath, 0o755);
  return fakeGhPath;
}

function readCalls(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

// Turns `["api", "repos/{owner}/{repo}/statuses/abc123", "-f", "state=success", ...]`
// into { dest, fields: { state, context, description } }, ignoring flag order.
function readApiCall(args) {
  const dest = args[1];
  const fields = {};
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "-f") {
      const [key, ...rest] = args[i + 1].split("=");
      fields[key] = rest.join("=");
      i++;
    }
  }
  return { dest, fields };
}

async function run(args, { env } = {}) {
  const dir = tempDir();
  const logPath = path.join(dir, "calls.log");
  writeFakeGh(dir, logPath);
  try {
    const result = await execFileAsync("node", [SCRIPT, ...args], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...env },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr, calls: readCalls(logPath) };
  } catch (err) {
    return {
      code: err.code,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      calls: readCalls(logPath),
    };
  }
}

test("posts a success status with a passing description for pass", async () => {
  const { code, calls } = await run(["12", "pass"]);

  const apiCalls = calls.filter((args) => args[0] === "api");
  assert.equal(apiCalls.length, 1);
  const { dest, fields } = readApiCall(apiCalls[0]);
  assert.equal(dest, "repos/{owner}/{repo}/statuses/abc123");
  assert.equal(fields.state, "success");
  assert.equal(fields.context, "verifier");
  assert.equal(fields.description, "合格");
  assert.equal(code, 0);
});

test("posts a success status describing why verification was not needed", async () => {
  const withReason = await run(["12", "not-needed", "--reason", "振る舞いの制約がありません"]);
  let { fields } = readApiCall(withReason.calls.filter((a) => a[0] === "api")[0]);
  assert.equal(fields.state, "success");
  assert.equal(fields.description, "確認不要: 振る舞いの制約がありません");

  const withoutReason = await run(["12", "not-needed"]);
  ({ fields } = readApiCall(withoutReason.calls.filter((a) => a[0] === "api")[0]));
  assert.equal(fields.state, "success");
  assert.equal(fields.description, "確認不要");
  assert.equal(withoutReason.code, 0);
});

test("posts a failure status with the given reason", async () => {
  const { calls } = await run(["12", "fail", "--reason", "出力がありません"]);

  const { fields } = readApiCall(calls.filter((a) => a[0] === "api")[0]);
  assert.equal(fields.state, "failure");
  assert.equal(fields.description, "不合格: 出力がありません");
});

test("posts an error status with the given reason when unverifiable", async () => {
  const { calls } = await run(["12", "unverifiable", "--reason", "OPENROUTER_API_KEY がありません"]);

  const { fields } = readApiCall(calls.filter((a) => a[0] === "api")[0]);
  assert.equal(fields.state, "error");
  assert.equal(fields.description, "確認できない: OPENROUTER_API_KEY がありません");
});

test("truncates a long description to 140 characters ending in an ellipsis", async () => {
  const reason = "あ".repeat(200);
  const { calls } = await run(["12", "fail", "--reason", reason]);

  const { fields } = readApiCall(calls.filter((a) => a[0] === "api")[0]);
  assert.equal(fields.description.length, 140);
  assert.equal(fields.description.at(-1), "…");
});

test("refuses an unknown result or a missing reason without posting anything", async () => {
  for (const args of [["12", "done"], ["12", "fail"], ["12", "unverifiable"]]) {
    const result = await run(args);
    assert.equal(result.calls.some((a) => a[0] === "api"), false);
    assert.equal(result.code, 2);
  }
});

test("surfaces gh's own error and exits 1 when the status write fails", async () => {
  const { code, stdout, stderr } = await run(["12", "pass"], { env: { GH_API_FAIL: "1" } });

  assert.match(stdout + stderr, /HTTP 404/);
  assert.equal(code, 1);
});
