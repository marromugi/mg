import { describe, expect, it } from "vitest";
import { jsonAttribute } from "../json.js";
import { ATTR, EVENT } from "../vocabulary.js";
import { mapGenAiSpan } from "./genai-mapping.js";

const messages = [
  { role: "user", content: "what's the weather in Paris?" },
  {
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "call1",
        name: "get_weather",
        arguments: { location: "Paris" },
      },
    ],
  },
  { role: "tool", toolCallId: "call1", content: "rainy, 57F" },
];

describe("mapGenAiSpan", () => {
  it("maps all seven rows plus provider.name for an mg.llm span", () => {
    const mapped = mapGenAiSpan({
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmProvider]: "openrouter",
        [ATTR.llmModel]: "gpt-4",
        [ATTR.llmInputTokens]: 10,
        [ATTR.llmOutputTokens]: 20,
        [ATTR.llmFinishReason]: "stop",
        [ATTR.llmInputMessages]: jsonAttribute(messages),
        [ATTR.llmOutputMessages]: jsonAttribute([
          { role: "assistant", content: "it's rainy" },
        ]),
      },
      events: [],
    });

    expect(mapped["gen_ai.operation.name"]).toBe("chat");
    expect(mapped["gen_ai.system_instructions"]).toBeUndefined();
    expect(mapped["mg.llm.messages.input.unreadable"]).toBeUndefined();
    expect(mapped["gen_ai.provider.name"]).toBe("openrouter");
    expect(mapped["gen_ai.request.model"]).toBe("gpt-4");
    expect(mapped["gen_ai.usage.input_tokens"]).toBe(10);
    expect(mapped["gen_ai.usage.output_tokens"]).toBe(20);
    expect(mapped["gen_ai.response.finish_reasons"]).toEqual(["stop"]);

    expect(
      JSON.parse(mapped["gen_ai.input.messages"] as string),
    ).toEqual([
      {
        role: "user",
        parts: [
          { type: "text", content: "what's the weather in Paris?" },
        ],
      },
      {
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            id: "call1",
            name: "get_weather",
            arguments: { location: "Paris" },
          },
        ],
      },
      {
        role: "tool",
        parts: [
          {
            type: "tool_call_response",
            id: "call1",
            response: "rainy, 57F",
          },
        ],
      },
    ]);

    const outputMessages = JSON.parse(
      mapped["gen_ai.output.messages"] as string,
    );
    expect(outputMessages).toEqual([
      {
        role: "assistant",
        parts: [{ type: "text", content: "it's rainy" }],
      },
    ]);
    expect(outputMessages[0]).not.toHaveProperty("finish_reason");
  });

  it("omits gen_ai.response.finish_reasons when mg.llm.finish_reason is absent", () => {
    const mapped = mapGenAiSpan({
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmModel]: "gpt-4",
      },
      events: [],
    });

    expect(mapped["gen_ai.response.finish_reasons"]).toBeUndefined();
  });

  it("maps only operation.name for an mg.harness span", () => {
    const mapped = mapGenAiSpan({
      attributes: {
        [ATTR.op]: "harness",
        [ATTR.harnessName]: "my-harness",
      },
      events: [],
    });

    expect(mapped).toEqual({ "gen_ai.operation.name": "invoke_agent" });
  });

  it("maps operation.name and tool.name for an mg.tool span", () => {
    const mapped = mapGenAiSpan({
      attributes: {
        [ATTR.op]: "tool",
        [ATTR.toolName]: "get_weather",
      },
      events: [],
    });

    expect(mapped).toEqual({
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "get_weather",
    });
  });

  it("returns no attributes for an unknown mg.op", () => {
    expect(
      mapGenAiSpan({
        attributes: { [ATTR.op]: "unknown" },
        events: [],
      }),
    ).toEqual({});
  });

  it("returns no attributes when mg.op is absent", () => {
    expect(
      mapGenAiSpan({
        attributes: { [ATTR.llmModel]: "gpt-4" },
        events: [],
      }),
    ).toEqual({});
  });

  it("leaves out input messages and gives the reason when the input attribute is not JSON, without throwing", () => {
    const span = {
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmModel]: "gpt-4",
        [ATTR.llmInputMessages]: "not json",
      },
      events: [],
    };

    expect(() => mapGenAiSpan(span)).not.toThrow();
    const mapped = mapGenAiSpan(span);
    expect(mapped["gen_ai.input.messages"]).toBeUndefined();
    expect(mapped["mg.llm.messages.input.unreadable"]).toBe(
      "input messages are not a JSON array",
    );
    expect(mapped["gen_ai.request.model"]).toBe("gpt-4");
  });

  it("gives the reason when the input attribute is missing", () => {
    const mapped = mapGenAiSpan({
      attributes: { [ATTR.op]: "llm", [ATTR.llmModel]: "gpt-4" },
      events: [],
    });

    expect(mapped["gen_ai.input.messages"]).toBeUndefined();
    expect(mapped["mg.llm.messages.input.unreadable"]).toBe(
      "input messages are missing",
    );
  });

  it("puts system events at their positions in the input messages", () => {
    const expected = [
      {
        role: "system",
        parts: [{ type: "text", content: "be brief" }],
      },
      { role: "user", parts: [{ type: "text", content: "hi" }] },
    ];

    const fromEvent = mapGenAiSpan({
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmInputMessages]: jsonAttribute([
          { role: "user", content: "hi" },
        ]),
        [ATTR.llmSystemCount]: 1,
      },
      events: [
        {
          name: EVENT.llmSystem,
          attributes: {
            [ATTR.llmSystemContent]: "be brief",
            [ATTR.llmSystemIndex]: 0,
          },
        },
      ],
    });
    const fromAttribute = mapGenAiSpan({
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmInputMessages]: jsonAttribute([
          { role: "system", content: "be brief" },
          { role: "user", content: "hi" },
        ]),
      },
      events: [],
    });

    for (const mapped of [fromEvent, fromAttribute]) {
      expect(
        JSON.parse(mapped["gen_ai.input.messages"] as string),
      ).toEqual(expected);
      expect(mapped["gen_ai.system_instructions"]).toBeUndefined();
      expect(
        mapped["mg.llm.messages.input.unreadable"],
      ).toBeUndefined();
    }
  });

  it("gives the reason when a system event is missing", () => {
    const mapped = mapGenAiSpan({
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmInputMessages]: jsonAttribute([
          { role: "user", content: "a" },
        ]),
        [ATTR.llmSystemCount]: 2,
      },
      events: [
        {
          name: EVENT.llmSystem,
          attributes: {
            [ATTR.llmSystemContent]: "s",
            [ATTR.llmSystemIndex]: 0,
          },
        },
      ],
    });

    expect(mapped["gen_ai.input.messages"]).toBeUndefined();
    expect(mapped["mg.llm.messages.input.unreadable"]).toBe(
      "expected 2 system events, found 1",
    );
  });

  it("omits gen_ai.provider.name when mg.llm.provider is absent", () => {
    const mapped = mapGenAiSpan({
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmModel]: "gpt-4",
      },
      events: [],
    });

    expect(mapped["gen_ai.provider.name"]).toBeUndefined();
    expect("gen_ai.provider.name" in mapped).toBe(false);
  });

  it("marks the record unreadable when the input array holds elements that are not messages, without throwing", () => {
    const span = {
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmInputMessages]: JSON.stringify([
          null,
          { role: "user", content: "hi" },
          "x",
          42,
        ]),
      },
      events: [],
    };

    expect(() => mapGenAiSpan(span)).not.toThrow();
    const mapped = mapGenAiSpan(span);
    expect(mapped["gen_ai.input.messages"]).toBeUndefined();
    expect(mapped["mg.llm.messages.input.unreadable"]).toBe(
      "input message at 0 is not a message",
    );
  });

  it("marks the record unreadable when an input message has an unknown role", () => {
    const mapped = mapGenAiSpan({
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmInputMessages]: JSON.stringify([
          { role: "developer", content: "x" },
          { role: "developer" },
        ]),
      },
      events: [],
    });

    expect(mapped["gen_ai.input.messages"]).toBeUndefined();
    expect(mapped["mg.llm.messages.input.unreadable"]).toBe(
      "input message at 0 is not a message",
    );
  });

  it("maps an assistant message with a parts array, keeping reasoning, text and tool calls in order", () => {
    const raw = JSON.stringify([
      {
        role: "assistant",
        parts: [
          { type: "reasoning", text: "thinking it through" },
          { type: "text", text: "here is the answer" },
          {
            type: "tool-call",
            id: "call1",
            name: "get_weather",
            arguments: { location: "Paris" },
          },
        ],
      },
    ]);

    const mapped = mapGenAiSpan({
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmOutputMessages]: raw,
      },
      events: [],
    });

    expect(
      JSON.parse(mapped["gen_ai.output.messages"] as string),
    ).toEqual([
      {
        role: "assistant",
        parts: [
          { type: "reasoning", content: "thinking it through" },
          { type: "text", content: "here is the answer" },
          {
            type: "tool_call",
            id: "call1",
            name: "get_weather",
            arguments: { location: "Paris" },
          },
        ],
      },
    ]);
  });

  it("drops carry from a stored reasoning part and never surfaces it in the mapped attribute", () => {
    const raw = JSON.stringify([
      {
        role: "assistant",
        parts: [
          {
            type: "reasoning",
            text: "thinking",
            carry: { provider: "openrouter", data: { step: 1 } },
          },
        ],
      },
    ]);

    const mapped = mapGenAiSpan({
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmOutputMessages]: raw,
      },
      events: [],
    });

    const serialized = mapped["gen_ai.output.messages"] as string;
    expect(serialized).not.toContain("carry");
    expect(JSON.parse(serialized)).toEqual([
      {
        role: "assistant",
        parts: [{ type: "reasoning", content: "thinking" }],
      },
    ]);
  });

  it("reports an assistant message with a malformed part as unreadable", () => {
    const mapped = mapGenAiSpan({
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmOutputMessages]: JSON.stringify([
          {
            role: "assistant",
            parts: [{ type: "text", text: "kept" }, { type: "text" }],
          },
        ]),
      },
      events: [],
    });

    expect(mapped["gen_ai.output.messages"]).toBeUndefined();
    expect(mapped["mg.llm.messages.output.unreadable"]).toBe(
      "output message at 0 is not an assistant message",
    );
  });

  it("still maps an old-shape assistant message with content and toolCalls when no parts array is present", () => {
    const mapped = mapGenAiSpan({
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmOutputMessages]: jsonAttribute([
          {
            role: "assistant",
            content: "it's rainy",
            toolCalls: [
              { id: "call1", name: "get_weather", arguments: {} },
            ],
          },
        ]),
      },
      events: [],
    });

    expect(
      JSON.parse(mapped["gen_ai.output.messages"] as string),
    ).toEqual([
      {
        role: "assistant",
        parts: [
          { type: "text", content: "it's rainy" },
          {
            type: "tool_call",
            id: "call1",
            name: "get_weather",
            arguments: {},
          },
        ],
      },
    ]);
  });
});

describe("mapGenAiSpan output messages", () => {
  it("writes the reason and no output messages when the output is missing", () => {
    const mapped = mapGenAiSpan({
      attributes: { [ATTR.op]: "llm" },
      events: [],
    });

    expect(mapped["gen_ai.output.messages"]).toBeUndefined();
    expect(mapped["mg.llm.messages.output.unreadable"]).toBe(
      "output messages are missing",
    );
  });

  it("writes the reason when an output message is not an assistant message", () => {
    const mapped = mapGenAiSpan({
      attributes: {
        [ATTR.op]: "llm",
        [ATTR.llmOutputMessages]: JSON.stringify([
          { role: "user", content: "x" },
        ]),
      },
      events: [],
    });

    expect(mapped["gen_ai.output.messages"]).toBeUndefined();
    expect(mapped["mg.llm.messages.output.unreadable"]).toBe(
      "output message at 0 is not an assistant message",
    );
  });
});
