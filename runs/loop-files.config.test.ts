import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  GenerateRequest,
  GenerateResponse,
  Provider,
  ToolCall,
} from "@mg/core";
import { toToolCallRequest } from "@mg/gate";
import { run } from "@mg/runner";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "test";
const { buildLoopFilesRun } = await import("./loop-files.config.ts");

const REASON =
  "Secrets, lockfiles and .git are off limits for the agent.";
const POLICY =
  "Reading and editing project files is allowed. Reading or changing " +
  "secrets (.env files), lockfiles or anything under .git is not. " +
  "Running shell commands is not.";

const verdictResponse = (
  allowed: boolean,
  reason: string,
): GenerateResponse => ({
  parts: [
    {
      type: "tool-call",
      id: "v1",
      name: "verdict",
      arguments: { allowed, reason },
    },
  ],
  finishReason: "tool_calls",
});

const fakeProvider = (respond: () => GenerateResponse) => {
  const requests: GenerateRequest[] = [];
  const provider: Provider = {
    generate: async (request) => {
      requests.push(request);
      return respond();
    },
    stream: async function* (request) {
      requests.push(request);
      const response = respond();
      for (const part of response.parts) {
        if (part.type === "text")
          yield { type: "text-delta", delta: part.text };
        if (part.type === "tool-call")
          yield {
            type: "tool-call",
            toolCall: {
              id: part.id,
              name: part.name,
              arguments: part.arguments,
            },
          };
      }
      yield { type: "finish", finishReason: response.finishReason };
    },
  };
  return { provider, requests };
};

const failingProvider = () =>
  fakeProvider(() => {
    throw new Error("the provider must not be called");
  });

const judge = async (provider: Provider, call: ToolCall) => {
  const config = buildLoopFilesRun({ provider, root: process.cwd() });
  return config.gate.judge(
    await toToolCallRequest(config.tools ?? [], call),
  );
};

const denied = { allowed: false, reason: REASON };

describe("loop-files gate", () => {
  it("denies reading .env without asking the LLM gate", async () => {
    const { provider, requests } = failingProvider();
    const verdict = await judge(provider, {
      id: "c1",
      name: "read_file",
      arguments: { path: ".env" },
    });
    expect(verdict).toEqual(denied);
    expect(requests).toHaveLength(0);
  });

  it("denies writing, editing and grepping secrets, lockfiles and .git", async () => {
    const { provider, requests } = failingProvider();
    const calls: ToolCall[] = [
      {
        id: "c2a",
        name: "write_file",
        arguments: { path: "sub/.env.local", content: "x" },
      },
      {
        id: "c2b",
        name: "edit_file",
        arguments: {
          path: "yarn.lock",
          oldString: "a",
          newString: "b",
        },
      },
    ];
    for (const call of calls) {
      expect(await judge(provider, call)).toEqual(denied);
    }
    expect(
      await judge(provider, {
        id: "c2c",
        name: "grep",
        arguments: { pattern: "x", path: ".git" },
      }),
    ).toEqual({
      allowed: false,
      reason: `Rule 0 denied grep: the paths it touches could not be decided. ${REASON}`,
    });
    expect(requests).toHaveLength(0);
  });

  it("denies bash because its reach cannot be decided", async () => {
    const { provider, requests } = failingProvider();
    const verdict = await judge(provider, {
      id: "c3",
      name: "bash",
      arguments: { command: "ls" },
    });
    expect(verdict).toEqual({
      allowed: false,
      reason: `Rule 0 denied bash: the paths it touches could not be decided. ${REASON}`,
    });
    expect(requests).toHaveLength(0);
  });

  it("denies grep without a path", async () => {
    const { provider, requests } = failingProvider();
    const verdict = await judge(provider, {
      id: "c4",
      name: "grep",
      arguments: { pattern: "x" },
    });
    expect(verdict).toEqual(denied);
    expect(requests).toHaveLength(0);
  });

  it("denies reading .git as a file", async () => {
    const { provider, requests } = failingProvider();
    const verdict = await judge(provider, {
      id: "c8",
      name: "read_file",
      arguments: { path: ".git" },
    });
    expect(verdict).toEqual(denied);
    expect(requests).toHaveLength(0);
  });

  it("returns the LLM gate's denial for a call the rules let through", async () => {
    const { provider } = fakeProvider(() =>
      verdictResponse(false, "fake says no"),
    );
    const verdict = await judge(provider, {
      id: "c5",
      name: "read_file",
      arguments: { path: "README.md" },
    });
    expect(verdict).toEqual({ allowed: false, reason: "fake says no" });
  });

  it("asks the LLM gate once with the model and policy, and allows when both allow", async () => {
    let answer = verdictResponse(false, "fake says no");
    const { provider, requests } = fakeProvider(() => answer);
    const call: ToolCall = {
      id: "c6",
      name: "read_file",
      arguments: { path: "README.md" },
    };
    await judge(provider, call);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.model).toBe("deepseek/deepseek-v4-flash");
    const system = requests[0]?.messages[0];
    expect(system).toMatchObject({ role: "system" });
    expect(JSON.stringify(system)).toContain(POLICY);

    answer = verdictResponse(true, "fake says yes");
    expect(await judge(provider, call)).toEqual({
      allowed: true,
      reason: "All 2 gates allowed.",
    });
  });
});

describe("loop-files run", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "loop-files-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("records the run name loop-files-deepseek-composed in the trace", async () => {
    const { provider } = fakeProvider(() => ({
      parts: [{ type: "text", text: "done" }],
      finishReason: "stop",
    }));
    const jsonlPath = join(dir, "trace.jsonl");
    const config = buildLoopFilesRun({
      provider,
      root: process.cwd(),
      trace: { jsonlPath },
    });
    await run(config, [{ role: "user", content: "hi" }]);
    const spans = readFileSync(jsonlPath, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map(
        (line) =>
          JSON.parse(line) as {
            name: string;
            attributes: Record<string, unknown>;
          },
      );
    const runSpan = spans.find((span) => span.name === "mg.run");
    expect(runSpan?.attributes["mg.run.name"]).toBe(
      "loop-files-deepseek-composed",
    );
  });
});
