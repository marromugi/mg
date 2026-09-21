import { ATTR, SPAN } from "@mg/trace";
import type { SpanRecord } from "@mg/trace/store";
import { buildSessionTree } from "@mg/trace/store";
import { describe, expect, it } from "vitest";
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

const buildRunWithSubagentRecords = (): SpanRecord[] => [
  record({
    spanId: "run",
    name: SPAN.run,
    startTime: "2026-01-01T00:00:00.000Z",
    endTime: "2026-01-01T00:00:10.000Z",
    attributes: { [ATTR.op]: "run" },
  }),
  record({
    spanId: "harness",
    parentSpanId: "run",
    name: SPAN.harness,
    startTime: "2026-01-01T00:00:00.100Z",
    endTime: "2026-01-01T00:00:09.900Z",
    attributes: { [ATTR.op]: "harness", [ATTR.harnessName]: "loop" },
  }),
  record({
    spanId: "llm-1",
    parentSpanId: "harness",
    name: SPAN.llm,
    startTime: "2026-01-01T00:00:01.000Z",
    endTime: "2026-01-01T00:00:02.000Z",
    attributes: {
      [ATTR.op]: "llm",
      [ATTR.llmInputTokens]: 10,
      [ATTR.llmOutputTokens]: 5,
    },
  }),
  record({
    spanId: "subagent-1",
    parentSpanId: "harness",
    name: SPAN.subagent,
    startTime: "2026-01-01T00:00:03.000Z",
    endTime: "2026-01-01T00:00:04.000Z",
    attributes: {
      [ATTR.op]: "subagent",
      [ATTR.subagentName]: "researcher",
      [ATTR.subagentCallId]: "c1",
      [ATTR.subagentArguments]: JSON.stringify({ prompt: "x" }),
      [ATTR.subagentResult]: "found",
      [ATTR.threadId]: "t1",
    },
  }),
  record({
    spanId: "llm-2",
    parentSpanId: "harness",
    name: SPAN.llm,
    startTime: "2026-01-01T00:00:05.000Z",
    endTime: "2026-01-01T00:00:06.000Z",
    attributes: {
      [ATTR.op]: "llm",
      [ATTR.llmInputTokens]: 10,
      [ATTR.llmOutputTokens]: 5,
    },
  }),
];

describe("viewRun with a subagent call", () => {
  it("reads the mg.subagent span as a subagent step between the two llm steps", () => {
    const session = buildSessionTree(buildRunWithSubagentRecords());
    if (session === undefined) throw new Error("session not built");

    const view = viewRun(session);

    expect(view.steps.map((step) => step.type)).toEqual([
      "llm",
      "subagent",
      "llm",
    ]);
    expect(view.toolSteps).toEqual([]);
    expect(view.subagentSteps).toHaveLength(1);

    const subagentStep = view.steps[1];
    expect(subagentStep).toMatchObject({
      type: "subagent",
      name: "researcher",
      callId: "c1",
      arguments: { prompt: "x" },
      result: "found",
      threadId: "t1",
    });
  });

  it("carries the error status of a failed mg.subagent span, with no result", () => {
    const records = buildRunWithSubagentRecords().map((original) => {
      if (original.spanId !== "subagent-1") return original;
      const { [ATTR.subagentResult]: _result, ...rest } =
        original.attributes;
      return {
        ...original,
        attributes: rest,
        status: { code: 2, message: "boom" },
      };
    });
    const session = buildSessionTree(records);
    if (session === undefined) throw new Error("session not built");

    const view = viewRun(session);

    const subagentStep = view.subagentSteps[0];
    expect(subagentStep?.error).toBe("boom");
    expect(subagentStep?.result).toBeUndefined();
  });

  it("counts only the run trace's usage and turns when a thread trace shares the session", () => {
    const runRecords = buildRunWithSubagentRecords();
    const threadRecords: SpanRecord[] = [
      record({
        spanId: "thread-1",
        traceId: "trace-2",
        name: SPAN.thread,
        startTime: "2026-01-01T00:00:03.100Z",
        endTime: "2026-01-01T00:00:03.900Z",
        attributes: { [ATTR.op]: "thread", [ATTR.threadId]: "t1" },
      }),
      record({
        spanId: "thread-harness",
        parentSpanId: "thread-1",
        traceId: "trace-2",
        name: SPAN.harness,
        startTime: "2026-01-01T00:00:03.200Z",
        endTime: "2026-01-01T00:00:03.800Z",
        attributes: {
          [ATTR.op]: "harness",
          [ATTR.harnessName]: "loop",
        },
      }),
      record({
        spanId: "thread-llm",
        parentSpanId: "thread-harness",
        traceId: "trace-2",
        name: SPAN.llm,
        startTime: "2026-01-01T00:00:03.300Z",
        endTime: "2026-01-01T00:00:03.700Z",
        attributes: {
          [ATTR.op]: "llm",
          [ATTR.llmInputTokens]: 100,
          [ATTR.llmOutputTokens]: 50,
        },
      }),
    ];
    const session = buildSessionTree([...runRecords, ...threadRecords]);
    if (session === undefined) throw new Error("session not built");

    const view = viewRun(session);

    expect(view.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    expect(view.turnCount).toBe(2);
  });
});
