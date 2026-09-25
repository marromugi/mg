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
  command: "node --env-file-if-exists=.env runs/a.ts",
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

function run(args, { env = {}, ...options } = {}) {
  return execFileAsync(process.execPath, [SCRIPT, ...args], {
    ...options,
    env: { PATH: process.env.PATH, ...env },
  });
}

test("show prints the declaration with the keys missing from the given env file", async () => {
  const root = tempRoot();
  writeFixture(root);
  const envFile = path.join(root, ".env");
  fs.writeFileSync(envFile, "K1=x\n");

  const { stdout } = await run([
    "show",
    "runs/a.ts",
    "--env",
    envFile,
    "--root",
    root,
  ]);

  assert.equal(
    stdout,
    '{"entry":"runs/a.ts","command":"node --env-file-if-exists=.env runs/a.ts","needs":["K1","K2"],"burdens":["cost"],"missing":["K2"]}\n',
  );
});

test("show lists every needed key as missing when no env file is given and none is in the process environment", async () => {
  const root = tempRoot();
  writeFixture(root);

  const { stdout } = await run(["show", "runs/a.ts", "--root", root]);

  assert.equal(
    stdout,
    '{"entry":"runs/a.ts","command":"node --env-file-if-exists=.env runs/a.ts","needs":["K1","K2"],"burdens":["cost"],"missing":["K1","K2"]}\n',
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

test("show fails when the path given for the env file is a directory", async () => {
  const root = tempRoot();
  writeFixture(root);
  const dirPath = path.join(root, "not-a-file");
  fs.mkdirSync(dirPath);

  await assert.rejects(
    run(["show", "runs/a.ts", "--env", dirPath, "--root", root]),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /^cannot read env file /);
      return true;
    },
  );
});

test("show counts a key present in the process environment as satisfied even without an env file", async () => {
  const root = tempRoot();
  writeFixture(root);

  const { stdout } = await run(["show", "runs/a.ts", "--root", root], {
    env: { K1: "x" },
  });

  assert.equal(
    stdout,
    '{"entry":"runs/a.ts","command":"node --env-file-if-exists=.env runs/a.ts","needs":["K1","K2"],"burdens":["cost"],"missing":["K2"]}\n',
  );
});

test("show combines keys from the process environment and the env file", async () => {
  const root = tempRoot();
  writeFixture(root);
  const envFile = path.join(root, ".env");
  fs.writeFileSync(envFile, "K2=y\n");

  const { stdout } = await run(
    ["show", "runs/a.ts", "--env", envFile, "--root", root],
    { env: { K1: "x" } },
  );

  assert.equal(
    stdout,
    '{"entry":"runs/a.ts","command":"node --env-file-if-exists=.env runs/a.ts","needs":["K1","K2"],"burdens":["cost"],"missing":[]}\n',
  );
});

test("show treats a missing env file path as no file and still succeeds", async () => {
  const root = tempRoot();
  writeFixture(root);
  const envFile = path.join(root, "nonexistent.env");

  const { stdout } = await run([
    "show",
    "runs/a.ts",
    "--env",
    envFile,
    "--root",
    root,
  ]);

  assert.equal(
    stdout,
    '{"entry":"runs/a.ts","command":"node --env-file-if-exists=.env runs/a.ts","needs":["K1","K2"],"burdens":["cost"],"missing":["K1","K2"]}\n',
  );
});

test("show rejects an option it does not recognize", async () => {
  const root = tempRoot();
  writeFixture(root);

  await assert.rejects(
    run(["show", "runs/a.ts", "--root", root, "--verbose"]),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /Usage/);
      return true;
    },
  );
});

test("show counts a key set to an empty value in the process environment as missing even when the env file has it", async () => {
  const root = tempRoot();
  writeFixture(root);
  const envFile = path.join(root, ".env");
  fs.writeFileSync(envFile, "K1=x\nK2=y\n");

  const { stdout } = await run(
    ["show", "runs/a.ts", "--env", envFile, "--root", root],
    { env: { K1: "" } },
  );

  assert.equal(
    stdout,
    '{"entry":"runs/a.ts","command":"node --env-file-if-exists=.env runs/a.ts","needs":["K1","K2"],"burdens":["cost"],"missing":["K1"]}\n',
  );
});

test("check reports a command that always loads its env file with the equals form of --env-file", async () => {
  const root = tempRoot();
  writeFixture(root, { ...DECLARATION, command: "node --env-file=.env runs/a.ts" });

  await assert.rejects(run(["check", "--root", root]), (error) => {
    assert.equal(error.code, 1);
    assert.equal(
      error.stdout,
      "runs/a.entry.json: command must load env files with --env-file-if-exists\n",
    );
    return true;
  });
});

test("check reports a command that always loads its env file with the space form of --env-file", async () => {
  const root = tempRoot();
  writeFixture(root, { ...DECLARATION, command: "node --env-file .env runs/a.ts" });

  await assert.rejects(run(["check", "--root", root]), (error) => {
    assert.equal(error.code, 1);
    assert.equal(
      error.stdout,
      "runs/a.entry.json: command must load env files with --env-file-if-exists\n",
    );
    return true;
  });
});

test("show rejects its env file option when no path follows it", async () => {
  const root = tempRoot();
  writeFixture(root);

  await assert.rejects(
    run(["show", "runs/a.ts", "--root", root, "--env"]),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /Usage/);
      return true;
    },
  );
});

test("show parses the env file the way Node does, including an empty value and the export prefix", async () => {
  const root = tempRoot();
  writeFixture(root);
  const envFile = path.join(root, ".env");
  fs.writeFileSync(envFile, 'K1=""\nexport K2=y\n');

  const { stdout } = await run([
    "show",
    "runs/a.ts",
    "--env",
    envFile,
    "--root",
    root,
  ]);

  assert.equal(
    stdout,
    '{"entry":"runs/a.ts","command":"node --env-file-if-exists=.env runs/a.ts","needs":["K1","K2"],"burdens":["cost"],"missing":["K1"]}\n',
  );
});

test("check rejects the show command's env file option", async () => {
  const root = tempRoot();
  writeFixture(root);
  const envFile = path.join(root, ".env");
  fs.writeFileSync(envFile, "K1=x\n");

  await assert.rejects(
    run(["check", "--root", root, "--env", envFile]),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /Usage/);
      return true;
    },
  );
});

test("show rejects its env file option when the next argument is another option", async () => {
  const root = tempRoot();
  writeFixture(root);

  await assert.rejects(
    run(["show", "runs/a.ts", "--env", "--root", root]),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /Usage/);
      return true;
    },
  );
});

test("show rejects the option name Node reads for itself", async () => {
  const root = tempRoot();
  writeFixture(root);
  const envFile = path.join(root, ".env");
  fs.writeFileSync(envFile, "K1=x\n");

  await assert.rejects(
    run(["show", "runs/a.ts", "--root", root, "--env-file", envFile]),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /Usage/);
      return true;
    },
  );
});

test("show treats a dangling symlink at the env file path as no file and still succeeds", async () => {
  const root = tempRoot();
  writeFixture(root);
  const linkPath = path.join(root, "dangling.env");
  fs.symlinkSync(path.join(root, "nonexistent-target"), linkPath);

  const { stdout } = await run([
    "show",
    "runs/a.ts",
    "--env",
    linkPath,
    "--root",
    root,
  ]);

  assert.equal(
    stdout,
    '{"entry":"runs/a.ts","command":"node --env-file-if-exists=.env runs/a.ts","needs":["K1","K2"],"burdens":["cost"],"missing":["K1","K2"]}\n',
  );
});
