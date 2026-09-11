import { describe, expect, expectTypeOf, test } from "vitest";
import type { Harness, HarnessEvent, HarnessResult, HarnessStopReason } from "./types.js";

describe("Harness", () => {
  test("accepts an async generator yielding HarnessEvent", () => {
    async function* run(): AsyncIterable<HarnessEvent> {
      yield { type: "text-delta", delta: "hi" };
    }

    expectTypeOf(run).toMatchTypeOf<Harness>();
  });
});

describe("HarnessResult", () => {
  test("narrows reason to HarnessStopReason", () => {
    const result: HarnessResult = {
      reason: "stop",
      messages: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };

    expectTypeOf(result.reason).toEqualTypeOf<HarnessStopReason>();

    // @ts-expect-error reason must be one of the known stop reasons
    ({ reason: "unknown", messages: [], usage: { inputTokens: 0, outputTokens: 0 } }) satisfies HarnessResult;

    expect(result.reason).toBe("stop");
  });
});

describe("HarnessEvent", () => {
  test("discriminates on type", () => {
    const describeEvent = (event: HarnessEvent): string => {
      switch (event.type) {
        case "text-delta":
          expectTypeOf(event).toEqualTypeOf<Extract<HarnessEvent, { type: "text-delta" }>>();
          return `text:${event.delta}`;
        case "tool-call":
          expectTypeOf(event).toEqualTypeOf<Extract<HarnessEvent, { type: "tool-call" }>>();
          return `call:${event.toolCall.name}`;
        case "tool-result":
          expectTypeOf(event).toEqualTypeOf<Extract<HarnessEvent, { type: "tool-result" }>>();
          return `result:${event.message.toolCallId}`;
        case "turn":
          expectTypeOf(event).toEqualTypeOf<Extract<HarnessEvent, { type: "turn" }>>();
          return `turn:${event.finishReason}`;
        case "done":
          expectTypeOf(event).toEqualTypeOf<Extract<HarnessEvent, { type: "done" }>>();
          return `done:${event.result.reason}`;
      }
    };

    expect(describeEvent({ type: "text-delta", delta: "hi" })).toBe("text:hi");
    expect(
      describeEvent({
        type: "tool-call",
        toolCall: { id: "call-1", name: "weather", arguments: { city: "Tokyo" } },
      }),
    ).toBe("call:weather");
    expect(
      describeEvent({
        type: "tool-result",
        message: { role: "tool", toolCallId: "call-1", content: "24" },
      }),
    ).toBe("result:call-1");
    expect(
      describeEvent({
        type: "turn",
        finishReason: "stop",
        usage: { inputTokens: 12, outputTokens: 34 },
      }),
    ).toBe("turn:stop");
    expect(
      describeEvent({
        type: "done",
        result: { reason: "stop", messages: [], usage: { inputTokens: 12, outputTokens: 34 } },
      }),
    ).toBe("done:stop");
  });
});
