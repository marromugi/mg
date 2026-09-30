import {
  assertRetrySchedule,
  defaultSleep,
  nextRetryStep,
} from "../retry/index.js";
import type { RetrySchedule } from "../retry/index.js";
import {
  isProviderError,
  ProviderRetryExhaustedError,
} from "./errors.js";
import type {
  GenerateRequest,
  GenerateResponse,
  Provider,
  StreamEvent,
} from "./types.js";

export type RetryingProviderOptions<P extends Provider = Provider> = {
  provider: P;
} & RetrySchedule;

const HALTED_RESPONSE: GenerateResponse = {
  parts: [],
  finishReason: "halted",
};

export const createRetryingProvider = <P extends Provider>(
  options: RetryingProviderOptions<P>,
): Provider & Pick<P, "toolForcing"> => {
  assertRetrySchedule(options);

  const { provider, sleep = defaultSleep } = options;

  // Returns "retry" after the wait and "halted" when the request's halt
  // fired. Any other outcome is thrown.
  const afterFailure = async (
    error: unknown,
    attempts: number,
    request: GenerateRequest,
  ): Promise<"retry" | "halted"> => {
    if (!isProviderError(error) || !error.retryable) {
      throw error;
    }

    const step = nextRetryStep(options, attempts, error.retryAfterMs);

    if ("exhausted" in step) {
      throw new ProviderRetryExhaustedError(attempts, { cause: error });
    }

    try {
      await sleep(step.wait, request.halt);
    } catch (sleepError) {
      if (request.halt?.aborted) return "halted";
      throw sleepError;
    }

    return request.halt?.aborted ? "halted" : "retry";
  };

  const generate = async (
    request: GenerateRequest,
  ): Promise<GenerateResponse> => {
    let attempts = 0;

    for (;;) {
      attempts++;

      try {
        return await provider.generate(request);
      } catch (error) {
        if (
          (await afterFailure(error, attempts, request)) === "halted"
        ) {
          return HALTED_RESPONSE;
        }
      }
    }
  };

  async function* stream(
    request: GenerateRequest,
  ): AsyncGenerator<StreamEvent> {
    let attempts = 0;

    for (;;) {
      attempts++;
      let yielded = false;

      try {
        for await (const event of provider.stream(request)) {
          yielded = true;
          yield event;
        }
        return;
      } catch (error) {
        if (yielded) throw error;

        if (
          (await afterFailure(error, attempts, request)) === "halted"
        ) {
          yield { type: "finish", finishReason: "halted" };
          return;
        }
      }
    }
  }

  return {
    ...(provider.name === undefined ? {} : { name: provider.name }),
    toolForcing: provider.toolForcing,
    generate,
    stream,
  };
};
