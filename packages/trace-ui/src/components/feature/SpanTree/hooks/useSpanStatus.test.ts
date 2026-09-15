import type { SpanNode } from "@mg/trace/store";
import { describe, expect, it } from "vitest";
import { useSpanStatus } from "./useSpanStatus.js";

const buildNode = (status: SpanNode["status"]): SpanNode => ({
  sessionId: "session-1",
  serviceName: "svc",
  traceId: "trace-1",
  spanId: "span-1",
  name: "mg.tool",
  startTime: "2026-01-01T00:00:00.000Z",
  endTime: "2026-01-01T00:00:01.000Z",
  attributes: {},
  events: [],
  status,
  children: [],
});

describe("useSpanStatus", () => {
  it("is an error when the status code is the error code, with its message", () => {
    const node = buildNode({
      code: 2,
      message: "search failed: timeout",
    });
    expect(useSpanStatus(node)).toEqual({
      isError: true,
      message: "search failed: timeout",
    });
  });

  it("is not an error when the status code is not the error code", () => {
    const node = buildNode({ code: 0 });
    expect(useSpanStatus(node)).toEqual({
      isError: false,
      message: undefined,
    });
  });

  it("is not an error for a status code of the wrong sign or shape", () => {
    const node = buildNode({ code: -1 });
    expect(useSpanStatus(node)).toEqual({
      isError: false,
      message: undefined,
    });
  });
});
