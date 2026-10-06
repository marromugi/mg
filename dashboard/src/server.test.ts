import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SERVER = fileURLToPath(
  new URL("../dist/server.js", import.meta.url),
);

const running: ChildProcess[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const child of running.splice(0)) {
    child.kill("SIGKILL");
  }
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

// Starts the built server and resolves once it has printed its link.
const startBuilt = async (args: string[]): Promise<ChildProcess> => {
  const dir = await mkdtemp(join(tmpdir(), "mg-dashboard-"));
  dirs.push(dir);
  const child = spawn(
    process.execPath,
    [SERVER, "--data-dir", dir, ...args],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  running.push(child);
  await new Promise<void>((resolve, reject) => {
    child.stdout?.once("data", () => resolve());
    child.once("exit", () => reject(new Error("exited early")));
  });
  return child;
};

const exitsWithin = (
  child: ChildProcess,
  ms: number,
): Promise<boolean> =>
  new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), ms);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

describe("server --exit-when-stdin-closes", () => {
  it("exits after its stdin is closed", async () => {
    const child = await startBuilt(["--exit-when-stdin-closes"]);

    child.stdin?.end();

    expect(await exitsWithin(child, 3000)).toBe(true);
  });

  it("keeps running after its stdin is closed without the option", async () => {
    const child = await startBuilt([]);

    child.stdin?.end();

    expect(await exitsWithin(child, 1000)).toBe(false);
  });
});
