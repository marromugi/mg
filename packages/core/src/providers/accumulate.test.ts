import { describe, expect, test } from "vitest";
import { createPartsAccumulator } from "./accumulate.js";
import type {
  AssistantPart,
  ReasoningCarry,
  ToolCall,
} from "./types.js";

const toolCall: ToolCall = {
  id: "call-1",
  name: "search",
  arguments: { query: "weather" },
};

const carry: ReasoningCarry = {
  provider: "openrouter",
  data: { id: "r1" },
};

describe("createPartsAccumulator", () => {
  test("joins consecutive text deltas into one text part", () => {
    const accumulator = createPartsAccumulator();

    accumulator.push({ type: "text-delta", delta: "hel" });
    accumulator.push({ type: "text-delta", delta: "lo" });

    expect(accumulator.parts()).toEqual<AssistantPart[]>([
      { type: "text", text: "hello" },
    ]);
  });

  test("keeps five parts in order across reasoning, text and a tool call", () => {
    const accumulator = createPartsAccumulator();

    accumulator.push({ type: "reasoning-delta", delta: "first " });
    accumulator.push({ type: "reasoning-delta", delta: "thought" });
    accumulator.push({ type: "text-delta", delta: "hel" });
    accumulator.push({ type: "text-delta", delta: "lo" });
    accumulator.push({ type: "tool-call", toolCall });
    accumulator.push({ type: "reasoning-delta", delta: "second" });
    accumulator.push({ type: "text-delta", delta: "world" });

    expect(accumulator.parts()).toEqual<AssistantPart[]>([
      { type: "reasoning", text: "first thought" },
      { type: "text", text: "hello" },
      { type: "tool-call", ...toolCall },
      { type: "reasoning", text: "second" },
      { type: "text", text: "world" },
    ]);
  });

  test("ignores finish events", () => {
    const accumulator = createPartsAccumulator();

    accumulator.push({ type: "text-delta", delta: "hi" });
    accumulator.push({
      type: "finish",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    expect(accumulator.parts()).toEqual<AssistantPart[]>([
      { type: "text", text: "hi" },
    ]);
  });

  test("attaches the last carry seen in a reasoning run", () => {
    const accumulator = createPartsAccumulator();
    const laterCarry: ReasoningCarry = {
      provider: "openrouter",
      data: { id: "r2" },
    };

    accumulator.push({
      type: "reasoning-delta",
      delta: "thinking",
      carry,
    });
    accumulator.push({
      type: "reasoning-delta",
      delta: " more",
      carry: laterCarry,
    });

    expect(accumulator.parts()).toEqual<AssistantPart[]>([
      { type: "reasoning", text: "thinking more", carry: laterCarry },
    ]);
  });

  test("keeps a carry-only empty reasoning delta", () => {
    const accumulator = createPartsAccumulator();

    accumulator.push({ type: "reasoning-delta", delta: "", carry });

    expect(accumulator.parts()).toEqual<AssistantPart[]>([
      { type: "reasoning", text: "", carry },
    ]);
  });

  test("drops an empty text delta without a carry", () => {
    const accumulator = createPartsAccumulator();

    accumulator.push({ type: "text-delta", delta: "" });
    accumulator.push({ type: "tool-call", toolCall });

    expect(accumulator.parts()).toEqual<AssistantPart[]>([
      { type: "tool-call", ...toolCall },
    ]);
  });

  test("drops an empty reasoning delta without a carry", () => {
    const accumulator = createPartsAccumulator();

    accumulator.push({ type: "reasoning-delta", delta: "" });
    accumulator.push({ type: "tool-call", toolCall });

    expect(accumulator.parts()).toEqual<AssistantPart[]>([
      { type: "tool-call", ...toolCall },
    ]);
  });

  test("parts() does not mutate or close the open run", () => {
    const accumulator = createPartsAccumulator();

    accumulator.push({ type: "text-delta", delta: "hel" });
    expect(accumulator.parts()).toEqual<AssistantPart[]>([
      { type: "text", text: "hel" },
    ]);

    accumulator.push({ type: "text-delta", delta: "lo" });
    expect(accumulator.parts()).toEqual<AssistantPart[]>([
      { type: "text", text: "hello" },
    ]);
  });
});
