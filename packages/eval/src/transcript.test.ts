import type { Message } from "@mg/core";
import { describe, expect, it } from "vitest";
import { transcribe } from "./transcript.js";
import type { GateStep, LlmStep, RunView, ToolStep } from "./view.js";

const baseTimes = {
  startTime: "2026-01-01T00:00:00.000Z",
  endTime: "2026-01-01T00:00:01.000Z",
};

const llmStep1: LlmStep = {
  type: "llm",
  spanId: "llm-1",
  ...baseTimes,
  model: "gpt-4o-mini",
  input: [
    { role: "system", content: "You are a helpful assistant." },
    {
      role: "user",
      content: "List the files in the current directory.",
    },
  ],
  output: [
    {
      role: "assistant",
      parts: [
        {
          type: "tool-call",
          id: "call-1",
          name: "bash",
          arguments: { cmd: "ls" },
        },
      ],
    },
  ],
};

const gateStep: GateStep = {
  type: "gate",
  spanId: "gate-1",
  ...baseTimes,
  kind: "tool-call",
  description: "Runs `bash` with command: ls",
  allowed: true,
  reason: "matches the policy",
};

const toolStep: ToolStep = {
  type: "tool",
  spanId: "tool-1",
  ...baseTimes,
  name: "bash",
  callId: "call-1",
  arguments: { cmd: "ls" },
  result: "file1\nfile2",
};

const llmStep2: LlmStep = {
  type: "llm",
  spanId: "llm-2",
  ...baseTimes,
  model: "gpt-4o-mini",
  input: [],
  output: [
    {
      role: "assistant",
      parts: [{ type: "text", text: "Done, I listed the files." }],
    },
  ],
};

const view: RunView = {
  sessionId: "session-1",
  runName: "my-run",
  harnessName: "loop",
  steps: [llmStep1, gateStep, toolStep, llmStep2],
  llmSteps: [llmStep1, llmStep2],
  toolSteps: [toolStep],
  gateSteps: [gateStep],
  subagentSteps: [],
  turnCount: 2,
  finalText: "Done, I listed the files.",
  usage: { inputTokens: 30, outputTokens: 13 },
  ...baseTimes,
};

describe("transcribe", () => {
  it("writes a deterministic, human-readable transcript", () => {
    const expected = [
      "[system] You are a helpful assistant.",
      "[user] List the files in the current directory.",
      '[assistant tool-call bash] {"cmd":"ls"}',
      "[gate tool-call allowed] matches the policy",
      "[tool bash] file1\nfile2",
      "[assistant] Done, I listed the files.",
    ].join("\n\n");

    expect(transcribe(view)).toBe(expected);
  });

  it("truncates a tool result to maxToolResultLength with a trailing ellipsis", () => {
    const longResultView: RunView = {
      ...view,
      steps: [toolStep],
      llmSteps: [],
      toolSteps: [toolStep],
      gateSteps: [],
    };

    const result = transcribe(longResultView, {
      maxToolResultLength: 5,
    });

    expect(result).toBe("[tool bash] file1…");
  });

  it("formats a failed tool step with its error instead of the result", () => {
    const failedTool: ToolStep = {
      ...toolStep,
      result: undefined,
      error: "command not found",
    };
    const failedView: RunView = {
      ...view,
      steps: [failedTool],
      llmSteps: [],
      toolSteps: [failedTool],
      gateSteps: [],
    };

    expect(transcribe(failedView)).toBe(
      "[tool bash error] command not found",
    );
  });

  it("formats a denied gate step", () => {
    const deniedGate: GateStep = {
      ...gateStep,
      allowed: false,
      reason: "writes to disk",
    };
    const deniedView: RunView = {
      ...view,
      steps: [deniedGate],
      llmSteps: [],
      toolSteps: [],
      gateSteps: [deniedGate],
    };

    expect(transcribe(deniedView)).toBe(
      "[gate tool-call denied] writes to disk",
    );
  });

  it("skips an input message with an unrecognized role instead of throwing", () => {
    const unknownRoleMessage = {
      role: "other",
      content: "not a real role",
    } as unknown as Message;
    const stepWithUnknownRole: LlmStep = {
      ...llmStep1,
      input: [...llmStep1.input, unknownRoleMessage],
    };
    const viewWithUnknownRole: RunView = {
      ...view,
      steps: [stepWithUnknownRole],
      llmSteps: [stepWithUnknownRole],
      toolSteps: [],
      gateSteps: [],
    };

    const expected = [
      "[system] You are a helpful assistant.",
      "[user] List the files in the current directory.",
      '[assistant tool-call bash] {"cmd":"ls"}',
    ].join("\n\n");

    expect(transcribe(viewWithUnknownRole)).toBe(expected);
  });

  it("does not repeat later llm steps' input, since it is history", () => {
    const result = transcribe(view);

    expect(result).not.toContain(
      "[user] List the files in the current directory.\n\n[user]",
    );
    expect(
      result.split("[user] List the files in the current directory.")
        .length,
    ).toBe(2);
  });
});
