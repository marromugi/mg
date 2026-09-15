import { describe, expect, test } from "vitest";
import { collect } from "./collect.js";
import { HarnessIncompleteError } from "./errors.js";
import type { HarnessEvent, HarnessResult } from "./types.js";

const result: HarnessResult = {
  reason: "stop",
  messages: [],
  usage: { inputTokens: 1, outputTokens: 2 },
};

describe("collect", () => {
  test("returns the done result", async () => {
    async function* run(): AsyncGenerator<HarnessEvent> {
      yield { type: "text-delta", delta: "hi" };
      yield { type: "turn", finishReason: "stop" };
      yield { type: "done", result };
    }

    await expect(collect(run())).resolves.toEqual(result);
  });

  test("never pulls events after done", async () => {
    let consumed = 0;

    async function* run(): AsyncGenerator<HarnessEvent> {
      consumed++;
      yield { type: "done", result };
      consumed++;
      yield { type: "text-delta", delta: "unreachable" };
    }

    await collect(run());

    expect(consumed).toBe(1);
  });

  test("rejects with HarnessIncompleteError when the stream ends without done", async () => {
    async function* run(): AsyncGenerator<HarnessEvent> {
      yield { type: "text-delta", delta: "hi" };
    }

    await expect(collect(run())).rejects.toBeInstanceOf(
      HarnessIncompleteError,
    );
  });

  test("propagates an error thrown by the iterable", async () => {
    const boom = new Error("boom");

    async function* run(): AsyncGenerator<HarnessEvent> {
      yield { type: "text-delta", delta: "hi" };
      throw boom;
    }

    await expect(collect(run())).rejects.toBe(boom);
  });
});
