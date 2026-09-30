import { describe, expect, test } from "vitest";
import { spawnProcess } from "./node-spawn.ts";

const readAll = async (
  output: AsyncIterable<Uint8Array>,
): Promise<string> => {
  const parts: Buffer[] = [];
  for await (const part of output) parts.push(Buffer.from(part));
  return Buffer.concat(parts).toString();
};

describe("spawnProcess", () => {
  test("gives the output and the exit code of a process that exits", async () => {
    const child = spawnProcess("node", [
      "-e",
      "process.stdout.write('hi'); process.exit(3)",
    ]);
    expect(await readAll(child.stdout)).toBe("hi");
    expect(await child.exit).toEqual({ code: 3 });
  });

  test("gives the signal of a process a signal ended", async () => {
    const child = spawnProcess("node", [
      "-e",
      "process.kill(process.pid, 'SIGTERM')",
    ]);
    expect(await child.exit).toEqual({ signal: "SIGTERM" });
  });

  test("rejects the exit of a command that cannot run and ends the output", async () => {
    const child = spawnProcess("mg-no-such-command", []);
    await expect(child.exit).rejects.toThrow();
    expect(await readAll(child.stdout)).toBe("");
  });
});
