import { describe, expect, test } from "vitest";
import { createShellTool } from "./tool.js";
import type { SshClient, SshExecResult } from "./client.js";

type ExecCall = {
  command: string;
  options: {
    timeoutMs: number;
    maxOutputBytes: number;
    signal?: AbortSignal;
  };
};

const okResult = (
  overrides: Partial<
    SshExecResult & { timedOut: boolean; truncated: boolean }
  > = {},
): SshExecResult & { timedOut: boolean; truncated: boolean } => ({
  stdout: "",
  stderr: "",
  code: 0,
  signal: null,
  timedOut: false,
  truncated: false,
  ...overrides,
});

const createFakeClient = (
  result: SshExecResult & { timedOut: boolean; truncated: boolean },
): SshClient & { calls: ExecCall[]; endCalls: number } => {
  const client: SshClient & { calls: ExecCall[]; endCalls: number } = {
    calls: [],
    endCalls: 0,
    async exec(command, options) {
      client.calls.push({ command, options });
      options.signal?.throwIfAborted();
      return result;
    },
    async end() {
      client.endCalls += 1;
    },
  };
  return client;
};

describe("createShellTool", () => {
  test("is named shell and sends the command as-is when there is no cwd", async () => {
    const client = createFakeClient(okResult({ stdout: "hi" }));
    const tool = createShellTool(client, {});

    expect(tool.name).toBe("shell");
    await (await tool.prepare({ command: "echo hi" })).run({});

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].command).toBe("echo hi");
  });

  test("prefixes the command with a quoted cd when cwd is set", async () => {
    const client = createFakeClient(okResult());
    const tool = createShellTool(client, { cwd: "/it's/a dir" });

    await (await tool.prepare({ command: "echo hi" })).run({});

    expect(client.calls[0].command).toBe(
      "cd '/it'\\''s/a dir' && echo hi",
    );
  });

  test("passes timeoutMs and maxOutputBytes through to the client", async () => {
    const client = createFakeClient(okResult());
    const tool = createShellTool(client, {
      timeoutMs: 1_000,
      maxOutputBytes: 10,
    });

    await (await tool.prepare({ command: "echo hi" })).run({});

    expect(client.calls[0].options.timeoutMs).toBe(1_000);
    expect(client.calls[0].options.maxOutputBytes).toBe(10);
  });

  test("formats stdout, stderr and a non-zero exit code like the bash tool", async () => {
    const client = createFakeClient(
      okResult({ stdout: "out\n", stderr: "err\n", code: 3 }),
    );
    const tool = createShellTool(client, {});

    const result = await (
      await tool.prepare({ command: "cmd" })
    ).run({});

    expect(result).toBe("out\n[stderr]\nerr\n[exit code: 3]");
  });

  test("omits the exit code line on a zero exit code", async () => {
    const client = createFakeClient(
      okResult({ stdout: "out", code: 0 }),
    );
    const tool = createShellTool(client, {});

    await expect(
      (await tool.prepare({ command: "cmd" })).run({}),
    ).resolves.toBe("out");
  });

  test("marks a killing signal", async () => {
    const client = createFakeClient(
      okResult({ stdout: "out", code: null, signal: "SIGKILL" }),
    );
    const tool = createShellTool(client, {});

    await expect(
      (await tool.prepare({ command: "cmd" })).run({}),
    ).resolves.toBe("out\n[killed by SIGKILL]");
  });

  test("marks a timeout", async () => {
    const client = createFakeClient(okResult({ timedOut: true }));
    const tool = createShellTool(client, { timeoutMs: 5_000 });

    await expect(
      (await tool.prepare({ command: "cmd" })).run({}),
    ).resolves.toBe("[timed out after 5000 ms]");
  });

  test("marks truncated output", async () => {
    const client = createFakeClient(
      okResult({ stdout: "out", truncated: true }),
    );
    const tool = createShellTool(client, {});

    await expect(
      (await tool.prepare({ command: "cmd" })).run({}),
    ).resolves.toBe("out\n[output truncated]");
  });

  test("lets an AbortError from an already-aborted signal through", async () => {
    const client = createFakeClient(okResult());
    const tool = createShellTool(client, {});
    const controller = new AbortController();
    controller.abort();

    await expect(
      (await tool.prepare({ command: "cmd" })).run({
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
