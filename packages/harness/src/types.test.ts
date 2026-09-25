import { describe, expect, expectTypeOf, test } from "vitest";
import type {
  Harness,
  HarnessEvent,
  HarnessInput,
  HarnessResult,
  HarnessStopReason,
} from "./types.js";

describe("HarnessInput", () => {
  test("wrapUp is an optional AbortSignal separate from signal", () => {
    expectTypeOf<HarnessInput["wrapUp"]>().toEqualTypeOf<
      AbortSignal | undefined
    >();
    expectTypeOf<HarnessInput["signal"]>().toEqualTypeOf<
      AbortSignal | undefined
    >();
  });
});

describe("Harness", () => {
  test("accepts an async generator yielding HarnessEvent", () => {
    async function* run(
      input: HarnessInput,
    ): AsyncGenerator<HarnessEvent> {
      yield {
        type: "text-delta",
        delta: `${input.messages.length}:${input.signal?.aborted}`,
      };
    }

    expectTypeOf(run).toExtend<Harness>();
  });

  test("rejects a generator with the wrong input type", () => {
    async function* run(input: {
      messages: string[];
    }): AsyncGenerator<HarnessEvent> {
      yield { type: "text-delta", delta: input.messages.join() };
    }

    // @ts-expect-error input must be HarnessInput
    expectTypeOf(run).toExtend<Harness>();
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

    ({
      // @ts-expect-error reason must be one of the known stop reasons
      reason: "unknown",
      messages: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    }) satisfies HarnessResult;

    expect(result.reason).toBe("stop");
  });

  test("accepts wrapped-up as a stop reason", () => {
    const result: HarnessResult = {
      reason: "wrapped-up",
      messages: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };

    expect(result.reason).toBe("wrapped-up");
  });
});

describe("HarnessEvent", () => {
  test("discriminates on type", () => {
    const describeEvent = (event: HarnessEvent): string => {
      switch (event.type) {
        case "text-delta":
          expectTypeOf(event).toEqualTypeOf<
            Extract<HarnessEvent, { type: "text-delta" }>
          >();
          return `text:${event.delta}`;
        case "reasoning-delta":
          expectTypeOf(event).toEqualTypeOf<
            Extract<HarnessEvent, { type: "reasoning-delta" }>
          >();
          return `reasoning:${event.delta}`;
        case "tool-call":
          expectTypeOf(event).toEqualTypeOf<
            Extract<HarnessEvent, { type: "tool-call" }>
          >();
          return `call:${event.toolCall.name}`;
        case "tool-result":
          expectTypeOf(event).toEqualTypeOf<
            Extract<HarnessEvent, { type: "tool-result" }>
          >();
          return `result:${event.message.toolCallId}`;
        case "turn":
          expectTypeOf(event).toEqualTypeOf<
            Extract<HarnessEvent, { type: "turn" }>
          >();
          return `turn:${event.finishReason}`;
        case "done":
          expectTypeOf(event).toEqualTypeOf<
            Extract<HarnessEvent, { type: "done" }>
          >();
          return `done:${event.result.reason}`;
      }
    };

    expect(describeEvent({ type: "text-delta", delta: "hi" })).toBe(
      "text:hi",
    );
    expect(
      describeEvent({ type: "reasoning-delta", delta: "hm" }),
    ).toBe("reasoning:hm");
    expect(
      describeEvent({
        type: "tool-call",
        toolCall: {
          id: "call-1",
          name: "weather",
          arguments: { city: "Tokyo" },
        },
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
        result: {
          reason: "stop",
          messages: [],
          usage: { inputTokens: 12, outputTokens: 34 },
        },
      }),
    ).toBe("done:stop");
  });
});
