import type { AssistantMessage, Message } from "@mg/core";
import { ATTR, SPAN } from "@mg/trace";
import type { SessionTree, SpanRecord } from "@mg/trace/store";
import { buildSessionTree } from "@mg/trace/store";
import { describe, expect, it } from "vitest";
import { NoRunInSessionError } from "./errors.js";
import { viewRun } from "./view.js";

const record = (
  overrides: Partial<SpanRecord> & Pick<SpanRecord, "spanId">,
): SpanRecord => ({
  sessionId: "session-1",
  serviceName: "svc",
  traceId: "trace-1",
  parentSpanId: undefined,
  name: "span",
  startTime: "2026-01-01T00:00:00.000Z",
  endTime: "2026-01-01T00:00:01.000Z",
  attributes: {},
  events: [],
  status: { code: 0 },
  ...overrides,
});

const json = (value: unknown): string => JSON.stringify(value);

const buildRunRecords = (): SpanRecord[] => {
  const initialMessages: Message[] = [
    { role: "user", content: "list files" },
  ];
  const turn1Output: AssistantMessage[] = [
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
  ];
  const gateJudgeInput: Message[] = [
    { role: "system", content: "policy" },
    { role: "user", content: "Kind: tool-call\nRuns `bash`" },
  ];
  const gateJudgeOutput: AssistantMessage[] = [
    {
      role: "assistant",
      parts: [
        {
          type: "tool-call",
          id: "verdict-call",
          name: "verdict",
          arguments: { allowed: true, reason: "matches the policy" },
        },
      ],
    },
  ];
  const turn2Output: AssistantMessage[] = [
    {
      role: "assistant",
      parts: [{ type: "text", text: "Done, I listed the files." }],
    },
  ];

  return [
    record({
      spanId: "run",
      name: SPAN.run,
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: "2026-01-01T00:00:10.000Z",
      attributes: {
        [ATTR.op]: "run",
        [ATTR.runName]: "my-run",
        [ATTR.runCase]: "case-1",
      },
    }),
    record({
      spanId: "harness",
      parentSpanId: "run",
      name: SPAN.harness,
      startTime: "2026-01-01T00:00:00.100Z",
      endTime: "2026-01-01T00:00:09.900Z",
      attributes: {
        [ATTR.op]: "harness",
        [ATTR.harnessName]: "loop",
      },
    }),
    record({
      spanId: "llm-1",
      parentSpanId: "harness",
      name: SPAN.llm,
      startTime: "2026-01-01T00:00:01.000Z",
      endTime: "2026-01-01T00:00:02.000Z",
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmModel]: "gpt-4o-mini",
        [ATTR.llmProvider]: "openai",
        [ATTR.llmFinishReason]: "tool_calls",
        [ATTR.llmInputMessages]: json(initialMessages),
        [ATTR.llmOutputMessages]: json(turn1Output),
        [ATTR.llmInputTokens]: 10,
        [ATTR.llmOutputTokens]: 5,
      },
    }),
    record({
      spanId: "gate-1",
      parentSpanId: "harness",
      name: SPAN.gate,
      startTime: "2026-01-01T00:00:03.000Z",
      endTime: "2026-01-01T00:00:04.000Z",
      attributes: {
        [ATTR.op]: "gate",
        [ATTR.gateKind]: "tool-call",
        [ATTR.gateDescription]: "Runs `bash` with command: ls",
        [ATTR.gateModel]: "gate-model",
        [ATTR.gateAllowed]: true,
        [ATTR.gateReason]: "matches the policy",
      },
    }),
    record({
      spanId: "gate-llm",
      parentSpanId: "gate-1",
      name: SPAN.llm,
      startTime: "2026-01-01T00:00:03.100Z",
      endTime: "2026-01-01T00:00:03.900Z",
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmModel]: "gate-model",
        [ATTR.llmInputMessages]: json(gateJudgeInput),
        [ATTR.llmOutputMessages]: json(gateJudgeOutput),
        [ATTR.llmInputTokens]: 1,
        [ATTR.llmOutputTokens]: 1,
      },
    }),
    record({
      spanId: "tool-1",
      parentSpanId: "harness",
      name: SPAN.tool,
      startTime: "2026-01-01T00:00:05.000Z",
      endTime: "2026-01-01T00:00:06.000Z",
      attributes: {
        [ATTR.op]: "tool",
        [ATTR.toolName]: "bash",
        [ATTR.toolCallId]: "call-1",
        [ATTR.toolArguments]: json({ cmd: "ls" }),
        [ATTR.toolResult]: "file1\nfile2",
      },
    }),
    record({
      spanId: "llm-2",
      parentSpanId: "harness",
      name: SPAN.llm,
      startTime: "2026-01-01T00:00:07.000Z",
      endTime: "2026-01-01T00:00:08.000Z",
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmModel]: "gpt-4o-mini",
        [ATTR.llmProvider]: "openai",
        [ATTR.llmFinishReason]: "stop",
        [ATTR.llmInputMessages]: json([
          ...initialMessages,
          ...turn1Output,
          {
            role: "tool",
            toolCallId: "call-1",
            content: "file1\nfile2",
          },
        ]),
        [ATTR.llmOutputMessages]: json(turn2Output),
        [ATTR.llmInputTokens]: 20,
        [ATTR.llmOutputTokens]: 8,
      },
    }),
  ];
};

describe("viewRun", () => {
  it("reads a full run into time-ordered steps and a summary", () => {
    const session = buildSessionTree(buildRunRecords());
    if (session === undefined) throw new Error("session not built");

    const view = viewRun(session);

    expect(view.sessionId).toBe("session-1");
    expect(view.runName).toBe("my-run");
    expect(view.caseId).toBe("case-1");
    expect(view.harnessName).toBe("loop");

    expect(view.steps.map((step) => step.type)).toEqual([
      "llm",
      "gate",
      "tool",
      "llm",
    ]);
    expect(view.steps.map((step) => step.spanId)).toEqual([
      "llm-1",
      "gate-1",
      "tool-1",
      "llm-2",
    ]);

    expect(view.turnCount).toBe(2);
    expect(view.llmSteps).toHaveLength(2);
    expect(view.toolSteps).toHaveLength(1);
    expect(view.gateSteps).toHaveLength(1);

    expect(view.finalText).toBe("Done, I listed the files.");
    expect(view.usage).toEqual({ inputTokens: 30, outputTokens: 13 });
    expect(view.error).toBeUndefined();
    expect(view.startTime).toBe("2026-01-01T00:00:00.000Z");
    expect(view.endTime).toBe("2026-01-01T00:00:10.000Z");

    const gateStep = view.gateSteps[0];
    expect(gateStep).toMatchObject({
      kind: "tool-call",
      description: "Runs `bash` with command: ls",
      allowed: true,
      reason: "matches the policy",
      model: "gate-model",
    });

    const toolStep = view.toolSteps[0];
    expect(toolStep).toMatchObject({
      name: "bash",
      callId: "call-1",
      arguments: { cmd: "ls" },
      result: "file1\nfile2",
    });
  });

  it("excludes the gate's inner llm call from llmSteps and turnCount", () => {
    const session = buildSessionTree(buildRunRecords());
    if (session === undefined) throw new Error("session not built");

    const view = viewRun(session);

    expect(view.steps.some((step) => step.spanId === "gate-llm")).toBe(
      false,
    );
    expect(view.turnCount).toBe(2);
  });

  it("falls back to a raw string when tool arguments fail to parse", () => {
    const records = [
      record({
        spanId: "run",
        name: SPAN.run,
        attributes: { [ATTR.op]: "run" },
      }),
      record({
        spanId: "tool-1",
        parentSpanId: "run",
        name: SPAN.tool,
        attributes: {
          [ATTR.op]: "tool",
          [ATTR.toolName]: "bash",
          [ATTR.toolArguments]: "not valid json",
        },
      }),
    ];
    const session = buildSessionTree(records);
    if (session === undefined) throw new Error("session not built");

    const view = viewRun(session);

    expect(view.toolSteps[0]?.arguments).toBe("not valid json");
  });

  it("throws NoRunInSessionError when the session has no traces", () => {
    const emptySession: SessionTree = {
      sessionId: "session-empty",
      serviceName: "svc",
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: "2026-01-01T00:00:00.000Z",
      traces: [],
    };

    expect(() => viewRun(emptySession)).toThrow(NoRunInSessionError);
  });

  it("falls back to the first trace when no trace root is mg.run", () => {
    const records = [
      record({
        spanId: "harness-b",
        traceId: "trace-b",
        name: SPAN.harness,
        startTime: "2026-01-01T00:00:05.000Z",
        endTime: "2026-01-01T00:00:06.000Z",
        attributes: {
          [ATTR.op]: "harness",
          [ATTR.harnessName]: "second",
        },
      }),
      record({
        spanId: "harness-a",
        traceId: "trace-a",
        name: SPAN.harness,
        startTime: "2026-01-01T00:00:01.000Z",
        endTime: "2026-01-01T00:00:02.000Z",
        attributes: {
          [ATTR.op]: "harness",
          [ATTR.harnessName]: "first",
        },
      }),
    ];
    const session = buildSessionTree(records);
    if (session === undefined) throw new Error("session not built");

    const view = viewRun(session);

    expect(view.harnessName).toBe("first");
  });

  it("picks the trace whose root classifies as a run by mg.op even when its name is not mg.run", () => {
    const records = [
      record({
        spanId: "harness-early",
        traceId: "trace-early",
        name: SPAN.harness,
        startTime: "2026-01-01T00:00:01.000Z",
        endTime: "2026-01-01T00:00:02.000Z",
        attributes: {
          [ATTR.op]: "harness",
          [ATTR.harnessName]: "not the run",
        },
      }),
      record({
        spanId: "custom-run",
        traceId: "trace-custom",
        name: "custom",
        startTime: "2026-01-01T00:00:05.000Z",
        endTime: "2026-01-01T00:00:06.000Z",
        attributes: {
          [ATTR.op]: "run",
          [ATTR.runName]: "custom-run-name",
        },
      }),
    ];
    const session = buildSessionTree(records);
    if (session === undefined) throw new Error("session not built");

    const view = viewRun(session);

    expect(view.runName).toBe("custom-run-name");
  });

  it("reports the root span's error status as the run error", () => {
    const records = [
      record({
        spanId: "run",
        name: SPAN.run,
        attributes: { [ATTR.op]: "run" },
        status: { code: 2, message: "boom" },
      }),
    ];
    const session = buildSessionTree(records);
    if (session === undefined) throw new Error("session not built");

    const view = viewRun(session);

    expect(view.error).toBe("boom");
  });

  it("falls back to a generic message for an error status without one", () => {
    const records = [
      record({
        spanId: "run",
        name: SPAN.run,
        attributes: { [ATTR.op]: "run" },
        status: { code: 2 },
      }),
    ];
    const session = buildSessionTree(records);
    if (session === undefined) throw new Error("session not built");

    const view = viewRun(session);

    expect(view.error).toBe("error");
  });
});
