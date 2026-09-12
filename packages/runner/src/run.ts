import type { Message } from "@mg/core";
import type { HarnessEvent, HarnessResult } from "@mg/harness";
import { collect } from "@mg/harness";
import { ATTR, SPAN, startRootSpan } from "@mg/trace";
import { createTraceSdk } from "@mg/trace/otel";
import type { RunConfig } from "./config.js";
import { createHarness } from "./harness.js";

export type RunOptions = {
  signal?: AbortSignal;
  sessionId?: string;
  onEvent?: (event: HarnessEvent) => void;
};

export type RunOutcome = { sessionId: string; result: HarnessResult };

async function* tee(
  events: AsyncIterable<HarnessEvent>,
  onEvent: ((event: HarnessEvent) => void) | undefined,
): AsyncGenerator<HarnessEvent> {
  for await (const event of events) {
    onEvent?.(event);
    yield event;
  }
}

export const run = async (
  config: RunConfig,
  messages: Message[],
  options?: RunOptions,
): Promise<RunOutcome> => {
  const sdk = createTraceSdk({ ...config.trace, sessionId: options?.sessionId });
  const root = startRootSpan(sdk.tracer, SPAN.run, {
    [ATTR.op]: "run",
    [ATTR.runName]: config.name,
  });

  let result: HarnessResult;
  try {
    const harness = createHarness(config);
    const events = tee(
      harness({ messages, signal: options?.signal, trace: root }),
      options?.onEvent,
    );
    result = await collect(events);
    root.end();
  } catch (error) {
    root.end(error);
    try {
      await sdk.shutdown();
    } catch {
      // The run error wins over a shutdown failure that follows it.
    }
    throw error;
  }

  await sdk.shutdown();
  return { sessionId: sdk.sessionId, result };
};
