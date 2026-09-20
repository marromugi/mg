import type { Message } from "@mg/core";
import type { HarnessEvent, HarnessResult } from "@mg/harness";
import { collect } from "@mg/harness";
import { ATTR, SPAN, startRootSpan } from "@mg/trace";
import { createTraceSdk } from "@mg/trace/otel";
import type { RunConfig } from "./config.js";
import { createHarness } from "./harness.js";
import {
  mergeWorkspaceTools,
  withWorkspace,
} from "./workspace-scope.js";

export type RunOptions = {
  signal?: AbortSignal;
  sessionId?: string;
  caseId?: string;
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
  const sdk = await createTraceSdk({
    ...config.trace,
    sessionId: options?.sessionId,
  });
  const root = startRootSpan(sdk.tracer, SPAN.run, {
    [ATTR.op]: "run",
    [ATTR.runName]: config.name,
    ...(options?.caseId !== undefined
      ? { [ATTR.runCase]: options.caseId }
      : {}),
  });

  let result: HarnessResult;
  try {
    result = await withWorkspace(
      config.workspace,
      { trace: root, signal: options?.signal },
      async (opened) => {
        const tools = mergeWorkspaceTools(config.tools ?? [], opened);
        const harness = createHarness(
          config.harness,
          config.provider,
          config.gate,
          tools,
        );
        const events = tee(
          harness({ messages, signal: options?.signal, trace: root }),
          options?.onEvent,
        );
        return collect(events);
      },
    );
  } catch (error) {
    root.end(error);
    try {
      await sdk.shutdown();
    } catch {
      // The run error wins over a shutdown failure that follows it.
    }
    throw error;
  }

  root.end();
  await sdk.shutdown();
  return { sessionId: sdk.sessionId, result };
};
