import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("./entries.mjs", import.meta.url));

const DECLARATION = {
  command: "node --env-file=.env runs/a.ts",
  needs: ["K1", "K2"],
  burdens: ["cost"],
};

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "entries-"));
}

function writeFixture(root, declaration = DECLARATION) {
  fs.mkdirSync(path.join(root, "runs"), { recursive: true });
  fs.writeFileSync(path.join(root, "runs", "a.ts"), "");
  fs.writeFileSync(
    path.join(root, "runs", "a.entry.json"),
    JSON.stringify(declaration),
  );
}

function run(args, options = {}) {
  return execFileAsync(process.execPath, [SCRIPT, ...args], options);
}

test("show prints the declaration with the keys missing from the given env file", async () => {
  const root = tempRoot();
  writeFixture(root);
  const envFile = path.join(root, ".env");
  fs.writeFileSync(envFile, "K1=x\n");

  const { stdout } = await run(
    ["show", "runs/a.ts", "--env", envFile, "--root", root],
  );

  assert.equal(
    stdout,
    '{"entry":"runs/a.ts","command":"node --env-file=.env runs/a.ts","needs":["K1","K2"],"burdens":["cost"],"missing":["K2"]}\n',
  );
});

test("show lists every needed key as missing when no env file is given", async () => {
  const root = tempRoot();
  writeFixture(root);

  const { stdout } = await run(["show", "runs/a.ts", "--root", root]);

  assert.equal(
    stdout,
    '{"entry":"runs/a.ts","command":"node --env-file=.env runs/a.ts","needs":["K1","K2"],"burdens":["cost"],"missing":["K1","K2"]}\n',
  );
});

test("show fails when the entry has no declaration", async () => {
  const root = tempRoot();
  writeFixture(root);

  await assert.rejects(
    run(["show", "runs/b.ts", "--root", root]),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, "no declaration for runs/b.ts\n");
      return true;
    },
  );
});

test("check reports how many declarations it read when every one is valid", async () => {
  const root = tempRoot();
  writeFixture(root);

  const { stdout } = await run(["check", "--root", root]);

  assert.equal(stdout, "ok: 1 declarations\n");
});

test("check reports every problem it finds in a malformed declaration", async () => {
  const root = tempRoot();
  writeFixture(root, { command: "", needs: "K1", burdens: ["money"] });

  await assert.rejects(run(["check", "--root", root]), (error) => {
    assert.equal(error.code, 1);
    assert.equal(
      error.stdout,
      "runs/a.entry.json: command must be a non-empty string\n" +
        "runs/a.entry.json: needs must be an array of strings\n" +
        'runs/a.entry.json: unknown burden "money"\n',
    );
    return true;
  });
});

test("check reports a declaration whose entry file is missing", async () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, "runs"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "runs", "c.entry.json"),
    JSON.stringify(DECLARATION),
  );

  await assert.rejects(run(["check", "--root", root]), (error) => {
    assert.equal(error.code, 1);
    assert.equal(
      error.stdout,
      "runs/c.entry.json: no entry file runs/c.ts\n",
    );
    return true;
  });
});

test("show fails when the given env file cannot be read", async () => {
  const root = tempRoot();
  writeFixture(root);

  await assert.rejects(
    run([
      "show",
      "runs/a.ts",
      "--env",
      path.join(root, "missing.env"),
      "--root",
      root,
    ]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /^cannot read env file /);
      return true;
    },
  );
});
