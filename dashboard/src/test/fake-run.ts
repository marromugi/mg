import type { Message } from "@mg/core";
import type { HarnessResult } from "@mg/harness";
import type { RunConfig, RunEntry, RunOptions } from "@mg/runner";

export type FakeRunCall = {
  config: RunConfig;
  messages: Message[];
  options: RunOptions;
};

// A `run` for tests of the pieces above it. The script plays the run:
// it sends events through `options.onEvent`, then returns the result or
// throws.
export const createFakeRun =
  (script: (call: FakeRunCall) => Promise<HarnessResult>): RunEntry =>
  async (
    config: RunConfig,
    messages: Message[],
    options: RunOptions = {},
  ) => ({
    sessionId: "fake-session",
    result: await script({ config, messages, options }),
  });

export const finishedResult = (
  reason: HarnessResult["reason"],
  usage = { inputTokens: 0, outputTokens: 0 },
): HarnessResult => ({ reason, messages: [], usage });

// Resolves when the signal aborts, the way a real run is cut short.
export const untilAborted = (signal: AbortSignal | undefined) =>
  new Promise<never>((_resolve, reject) => {
    signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    });
  });
