import type { SpanNode } from "@mg/trace/store";
import { describe, expect, it } from "vitest";
import { ATTR } from "../../../../vocabulary.js";
import { useToolSpan } from "./useToolSpan.js";

const buildNode = (attributes: SpanNode["attributes"]): SpanNode => ({
  sessionId: "session-1",
  serviceName: "svc",
  traceId: "trace-1",
  spanId: "span-1",
  name: "mg.tool",
  startTime: "2026-01-01T00:00:00.000Z",
  endTime: "2026-01-01T00:00:01.000Z",
  attributes,
  events: [],
  status: { code: 0 },
  children: [],
});

describe("useToolSpan", () => {
  it("reads every attribute when present with the right type", () => {
    const node = buildNode({
      [ATTR.toolName]: "web-search",
      [ATTR.toolArguments]: '{"query":"weather"}',
      [ATTR.toolResult]: "no results",
    });
    expect(useToolSpan(node)).toEqual({
      name: "web-search",
      arguments: '{"query":"weather"}',
      result: "no results",
    });
  });

  it("returns undefined for every field when attributes are absent", () => {
    expect(useToolSpan(buildNode({}))).toEqual({
      name: undefined,
      arguments: undefined,
      result: undefined,
    });
  });

  it("returns undefined for an attribute with the wrong type", () => {
    const node = buildNode({
      [ATTR.toolName]: 1,
      [ATTR.toolResult]: true,
    });
    expect(useToolSpan(node)).toEqual({
      name: undefined,
      arguments: undefined,
      result: undefined,
    });
  });
});
