import { mkdtempSync, realpathSync, rmSync } from "node:fs";
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

  test("includes stderr", async () => {
    const result = await (
      await bash.prepare({ command: "echo err 1>&2" })
    ).run({});
    expect(result).toContain("[stderr]");
    expect(result).toContain("err");
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

  test("returns the captured output cut at the size limit", async () => {
    const small = createBashTool({ cwd: dir, maxOutputBytes: 4 });
    await expect(
      (await small.prepare({ command: "echo 123456789" })).run({}),
    ).resolves.toBe("1234\n[output truncated]");
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
