import { describe, expect, it } from "vitest";
import type { Message } from "@mg/core";
import { jsonAttribute } from "../json.js";
import { ATTR } from "../vocabulary.js";
import { mapGenAiAttributes } from "./genai-mapping.js";

const messages: Message[] = [
  { role: "user", content: "what's the weather in Paris?" },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "call1", name: "get_weather", arguments: { location: "Paris" } }],
  },
  { role: "tool", toolCallId: "call1", content: "rainy, 57F" },
];

describe("mapGenAiAttributes", () => {
  it("maps all six rows plus provider.name for an mg.llm span", () => {
    const mapped = mapGenAiAttributes({
      [ATTR.op]: "llm",
      [ATTR.llmModel]: "gpt-4",
      [ATTR.llmInputTokens]: 10,
      [ATTR.llmOutputTokens]: 20,
      [ATTR.llmFinishReason]: "stop",
      [ATTR.llmInputMessages]: jsonAttribute(messages),
      [ATTR.llmOutputMessages]: jsonAttribute([
        { role: "assistant", content: "it's rainy" },
      ]),
    });

    expect(mapped["gen_ai.operation.name"]).toBe("chat");
    expect(mapped["gen_ai.provider.name"]).toBe("openrouter");
    expect(mapped["gen_ai.request.model"]).toBe("gpt-4");
    expect(mapped["gen_ai.usage.input_tokens"]).toBe(10);
    expect(mapped["gen_ai.usage.output_tokens"]).toBe(20);

    expect(JSON.parse(mapped["gen_ai.input.messages"] as string)).toEqual([
      { role: "user", parts: [{ type: "text", content: "what's the weather in Paris?" }] },
      {
        role: "assistant",
        parts: [{ type: "tool_call", id: "call1", name: "get_weather", arguments: { location: "Paris" } }],
      },
      { role: "tool", parts: [{ type: "tool_call_response", id: "call1", response: "rainy, 57F" }] },
    ]);

    expect(JSON.parse(mapped["gen_ai.output.messages"] as string)).toEqual([
      {
        role: "assistant",
        parts: [{ type: "text", content: "it's rainy" }],
        finish_reason: "stop",
      },
    ]);
  });

  it("maps only operation.name for an mg.harness span", () => {
    const mapped = mapGenAiAttributes({
      [ATTR.op]: "harness",
      [ATTR.harnessName]: "my-harness",
    });

    expect(mapped).toEqual({ "gen_ai.operation.name": "invoke_agent" });
  });

  it("maps operation.name and tool.name for an mg.tool span", () => {
    const mapped = mapGenAiAttributes({
      [ATTR.op]: "tool",
      [ATTR.toolName]: "get_weather",
    });

    expect(mapped).toEqual({
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "get_weather",
    });
  });

  it("returns no attributes for an unknown mg.op", () => {
    expect(mapGenAiAttributes({ [ATTR.op]: "unknown" })).toEqual({});
  });

  it("returns no attributes when mg.op is absent", () => {
    expect(mapGenAiAttributes({ [ATTR.llmModel]: "gpt-4" })).toEqual({});
  });

  it("skips message mapping when the JSON is unparseable, without throwing", () => {
    expect(() =>
      mapGenAiAttributes({
        [ATTR.op]: "llm",
        [ATTR.llmModel]: "gpt-4",
        [ATTR.llmInputMessages]: "not json",
      }),
    ).not.toThrow();

    const mapped = mapGenAiAttributes({
      [ATTR.op]: "llm",
      [ATTR.llmInputMessages]: "not json",
    });
    expect(mapped["gen_ai.input.messages"]).toBeUndefined();
    expect(mapped["gen_ai.provider.name"]).toBe("openrouter");
  });

  it("drops null and non-object elements from the message array without throwing", () => {
    const raw = JSON.stringify([null, { role: "user", content: "hi" }, "x", 42]);

    expect(() =>
      mapGenAiAttributes({ [ATTR.op]: "llm", [ATTR.llmInputMessages]: raw }),
    ).not.toThrow();

    const mapped = mapGenAiAttributes({
      [ATTR.op]: "llm",
      [ATTR.llmInputMessages]: raw,
    });
    expect(JSON.parse(mapped["gen_ai.input.messages"] as string)).toEqual([
      { role: "user", parts: [{ type: "text", content: "hi" }] },
    ]);
  });

  it("emits a text part for an unknown role when content is a string, and no parts otherwise", () => {
    const raw = JSON.stringify([
      { role: "developer", content: "x" },
      { role: "developer" },
    ]);

    const mapped = mapGenAiAttributes({
      [ATTR.op]: "llm",
      [ATTR.llmInputMessages]: raw,
    });

    expect(JSON.parse(mapped["gen_ai.input.messages"] as string)).toEqual([
      { role: "developer", parts: [{ type: "text", content: "x" }] },
      { role: "developer", parts: [] },
    ]);
  });
});
