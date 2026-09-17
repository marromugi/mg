import { describe, expect, test } from "vitest";
import {
  assistantMessage,
  partsOf,
  reasoningOf,
  textOf,
  toolCallsOf,
  type AssistantPart,
} from "./parts.js";
import type {
  AssistantMessage,
  GenerateResponse,
  ToolCall,
} from "./types.js";

const toolCall: ToolCall = {
  id: "call-1",
  name: "search",
  arguments: { query: "weather" },
};

const empty: AssistantMessage = { role: "assistant", parts: [] };
const textOnly: AssistantMessage = {
  role: "assistant",
  parts: [{ type: "text", text: "hello" }],
};
const toolCallsOnly: AssistantMessage = {
  role: "assistant",
  parts: [{ type: "tool-call", ...toolCall }],
};
const mixed: AssistantMessage = {
  role: "assistant",
  parts: [
    { type: "text", text: "hello" },
    { type: "tool-call", ...toolCall },
  ],
};

const response: GenerateResponse = {
  parts: [
    { type: "text", text: "hi" },
    { type: "tool-call", ...toolCall },
  ],
  finishReason: "stop",
};

describe("partsOf", () => {
  test("empty message yields no parts", () => {
    expect(partsOf(empty)).toEqual([]);
  });

  test("text only yields a text part", () => {
    expect(partsOf(textOnly)).toEqual([
      { type: "text", text: "hello" },
    ]);
  });

  test("tool calls only yields tool-call parts", () => {
    expect(partsOf(toolCallsOnly)).toEqual([
      { type: "tool-call", ...toolCall },
    ]);
  });

  test("mixed input yields text before tool calls", () => {
    expect(partsOf(mixed)).toEqual([
      { type: "text", text: "hello" },
      { type: "tool-call", ...toolCall },
    ]);
  });

  test("accepts a GenerateResponse", () => {
    expect(partsOf(response)).toEqual([
      { type: "text", text: "hi" },
      { type: "tool-call", ...toolCall },
    ]);
  });

  test("returns a copy, not the source array", () => {
    const parts = partsOf(textOnly);
    parts.push({ type: "text", text: "extra" });

    expect(textOnly.parts).toEqual([{ type: "text", text: "hello" }]);
  });
});

describe("textOf", () => {
  test("empty message yields an empty string", () => {
    expect(textOf(empty)).toBe("");
  });

  test("text only yields the text", () => {
    expect(textOf(textOnly)).toBe("hello");
  });

  test("tool calls only yields an empty string", () => {
    expect(textOf(toolCallsOnly)).toBe("");
  });

  test("mixed input yields just the text", () => {
    expect(textOf(mixed)).toBe("hello");
  });

  test("joins several text parts", () => {
    const message: AssistantMessage = {
      role: "assistant",
      parts: [
        { type: "text", text: "hel" },
        { type: "text", text: "lo" },
      ],
    };

    expect(textOf(message)).toBe("hello");
  });
});

describe("toolCallsOf", () => {
  test("empty message yields no tool calls", () => {
    expect(toolCallsOf(empty)).toEqual([]);
  });

  test("text only yields no tool calls", () => {
    expect(toolCallsOf(textOnly)).toEqual([]);
  });

  test("tool calls only yields the tool calls without a type key", () => {
    expect(toolCallsOf(toolCallsOnly)).toEqual([toolCall]);
  });

  test("mixed input yields just the tool calls", () => {
    expect(toolCallsOf(mixed)).toEqual([toolCall]);
  });
});

describe("reasoningOf", () => {
  test("empty message yields an empty string", () => {
    expect(reasoningOf(empty)).toBe("");
  });

  test("text only yields an empty string", () => {
    expect(reasoningOf(textOnly)).toBe("");
  });

  test("tool calls only yields an empty string", () => {
    expect(reasoningOf(toolCallsOnly)).toBe("");
  });

  test("mixed input yields an empty string", () => {
    expect(reasoningOf(mixed)).toBe("");
  });

  test("joins several reasoning parts with a newline", () => {
    const message: AssistantMessage = {
      role: "assistant",
      parts: [
        { type: "reasoning", text: "first" },
        { type: "text", text: "hello" },
        { type: "reasoning", text: "second" },
      ],
    };

    expect(reasoningOf(message)).toBe("first\nsecond");
  });
});

describe("assistantMessage", () => {
  test("empty parts yields an empty message", () => {
    expect(assistantMessage([])).toEqual({
      role: "assistant",
      parts: [],
    });
  });

  test("keeps parts in order", () => {
    const parts: AssistantPart[] = [
      { type: "text", text: "hello" },
      { type: "tool-call", ...toolCall },
    ];

    expect(assistantMessage(parts)).toEqual({
      role: "assistant",
      parts,
    });
  });

  test("keeps reasoning parts", () => {
    const parts: AssistantPart[] = [
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "hello" },
    ];

    expect(assistantMessage(parts)).toEqual({
      role: "assistant",
      parts,
    });
  });

  test("drops empty-text parts", () => {
    const parts: AssistantPart[] = [
      { type: "text", text: "" },
      { type: "tool-call", ...toolCall },
    ];

    expect(assistantMessage(parts)).toEqual({
      role: "assistant",
      parts: [{ type: "tool-call", ...toolCall }],
    });
  });

  test("keeps several non-empty text parts distinct", () => {
    const parts: AssistantPart[] = [
      { type: "text", text: "hel" },
      { type: "text", text: "lo" },
    ];

    expect(assistantMessage(parts)).toEqual({
      role: "assistant",
      parts,
    });
  });

  test("round trips text through partsOf", () => {
    const parts: AssistantPart[] = [{ type: "text", text: "hello" }];

    expect(partsOf(assistantMessage(parts))).toEqual(parts);
  });

  test("round trips tool calls through partsOf", () => {
    const parts: AssistantPart[] = [{ type: "tool-call", ...toolCall }];

    expect(partsOf(assistantMessage(parts))).toEqual(parts);
  });

  test("round trips mixed text and tool calls through partsOf", () => {
    const parts: AssistantPart[] = [
      { type: "text", text: "hello" },
      { type: "tool-call", ...toolCall },
    ];

    expect(partsOf(assistantMessage(parts))).toEqual(parts);
  });

  test("round trips reasoning through partsOf", () => {
    const parts: AssistantPart[] = [
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "hello" },
    ];

    expect(partsOf(assistantMessage(parts))).toEqual(parts);
  });
});
