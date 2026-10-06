import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@mg/core";
import { afterAll, describe, expect, expectTypeOf, test } from "vitest";
import { createBashTool } from "./bash.js";

const dir = mkdtempSync(join(tmpdir(), "mg-tools-bash-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const bash = createBashTool({ cwd: dir });

describe("createBashTool", () => {
  test("returns stdout without the trailing newline", async () => {
    await expect(
      (await bash.prepare({ command: "echo hi" })).run({}),
    ).resolves.toBe("hi");
  });

  test("reports a non-zero exit code instead of throwing", async () => {
    await expect(
      (await bash.prepare({ command: "exit 3" })).run({}),
    ).resolves.toContain("[exit code: 3]");
  });

  test("merges stdout and stderr in the order they arrive", async () => {
    await expect(
      (
        await bash.prepare({
          command: "echo one; echo two 1>&2; sleep 0.1; echo three",
        })
      ).run({}),
    ).resolves.toBe("one\ntwo\nthree");
  });

  test("runs in the configured working directory", async () => {
    await expect(
      (await bash.prepare({ command: "pwd" })).run({}),
    ).resolves.toBe(realpathSync(dir));
  });

  test("reports a timeout instead of throwing", async () => {
    const slow = createBashTool({ cwd: dir, timeoutMs: 100 });
    await expect(
      (await slow.prepare({ command: "sleep 5" })).run({}),
    ).resolves.toContain("[timed out after 100 ms]");
  });

  test("reports a timeout when the command handles the kill signal itself", async () => {
    const slow = createBashTool({ cwd: dir, timeoutMs: 50 });
    await expect(
      (
        await slow.prepare({ command: "trap 'exit 1' TERM; sleep 0.3" })
      ).run({}),
    ).resolves.toBe("[timed out after 50 ms]");
  });

  test("returns the end of a large output and saves all of it", async () => {
    const saved = join(dir, "saved");
    const small = createBashTool({
      cwd: dir,
      maxOutputBytes: 20,
      overflowDir: saved,
    });
    const result = await (
      await small.prepare({ command: "seq 1 50" })
    ).run({});
    const match =
      /^(.*)\n\[showing lines 44-50 of 50 \(20 B of 141 B\)\. Full output: (.+)\]$/s.exec(
        result,
      );
    expect(match?.[1]).toBe("44\n45\n46\n47\n48\n49\n50");
    const path = match?.[2] ?? "";
    expect(path.startsWith(saved)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(
      Array.from({ length: 50 }, (_, i) => `${i + 1}\n`).join(""),
    );
  });

  test("returns the end of a last line longer than the limit", async () => {
    const small = createBashTool({
      cwd: dir,
      maxOutputBytes: 5,
      overflowDir: join(dir, "saved"),
    });
    const result = await (
      await small.prepare({ command: "printf 'abc\\nあいうえお'" })
    ).run({});
    expect(result).toMatch(
      /^お\n\[showing the last 3 B of line 2 \(line is 15 B; 19 B in all\)\. Full output: .+\]$/,
    );
  });

  test("stops a command whose output passes the saved cap", async () => {
    const small = createBashTool({
      cwd: dir,
      maxOutputBytes: 10,
      maxSavedBytes: 100,
      overflowDir: join(dir, "saved"),
    });
    const result = await (
      await small.prepare({ command: "yes" })
    ).run({});
    expect(result).toMatch(
      /\]\n\[stopped: output passed 100 B; the first 100 B is saved\]$/,
    );
  });

  test("fails with the path when the output cannot be saved", async () => {
    const blocked = join(dir, "blocked");
    writeFileSync(blocked, "");
    const small = createBashTool({
      cwd: dir,
      maxOutputBytes: 5,
      overflowDir: blocked,
    });
    await expect(
      (await small.prepare({ command: "seq 1 50" })).run({}),
    ).rejects.toMatchObject({
      name: "BashOutputSaveError",
      path: expect.stringContaining(blocked) as unknown,
    });
  });

  test("reports a timeout while a background process holds the output open", async () => {
    const slow = createBashTool({ cwd: dir, timeoutMs: 300 });
    const started = Date.now();
    const result = await (
      await slow.prepare({ command: "sleep 4 & echo started" })
    ).run({});
    expect(result).toBe("started\n[timed out after 300 ms]");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("lets the abort error through", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      (await bash.prepare({ command: "sleep 5" })).run({
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  test("is a Tool whose input schema requires a command string", () => {
    expectTypeOf(bash).toExtend<Tool>();
    expect(bash.name).toBe("bash");

    const schema = bash.input["~standard"].jsonSchema.input({
      target: "draft-07",
    });
    expect(schema).toMatchObject({
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    });
  });
});
