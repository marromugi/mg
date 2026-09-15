import type { SpanNode } from "@mg/trace/store";
import { describe, expect, it } from "vitest";
import { ATTR } from "../../../../vocabulary.js";
import { useLlmSpan } from "./useLlmSpan.js";

const buildNode = (attributes: SpanNode["attributes"]): SpanNode => ({
  sessionId: "session-1",
  serviceName: "svc",
  traceId: "trace-1",
  spanId: "span-1",
  name: "mg.llm",
  startTime: "2026-01-01T00:00:00.000Z",
  endTime: "2026-01-01T00:00:01.000Z",
  attributes,
  events: [],
  status: { code: 0 },
  children: [],
});

describe("useLlmSpan", () => {
  it("reads every attribute when present with the right type", () => {
    const node = buildNode({
      [ATTR.llmModel]: "gpt-test",
      [ATTR.llmFinishReason]: "stop",
      [ATTR.llmInputTokens]: 10,
      [ATTR.llmOutputTokens]: 5,
      [ATTR.llmInputMessages]: "[]",
      [ATTR.llmOutputMessages]: "[]",
    });
    expect(useLlmSpan(node)).toEqual({
      model: "gpt-test",
      finishReason: "stop",
      inputTokens: 10,
      outputTokens: 5,
      inputMessages: "[]",
      outputMessages: "[]",
    });
  });

  it("returns undefined for every field when attributes are absent", () => {
    expect(useLlmSpan(buildNode({}))).toEqual({
      model: undefined,
      finishReason: undefined,
      inputTokens: undefined,
      outputTokens: undefined,
      inputMessages: undefined,
      outputMessages: undefined,
    });
  });

  it("returns undefined for an attribute with the wrong type", () => {
    const node = buildNode({
      [ATTR.llmModel]: 1,
      [ATTR.llmInputTokens]: "10",
    });
    const result = useLlmSpan(node);
    expect(result.model).toBeUndefined();
    expect(result.inputTokens).toBeUndefined();
  });
});
