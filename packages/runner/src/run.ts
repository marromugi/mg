import type { Message } from "@mg/core";
import type { HarnessEvent, HarnessResult } from "@mg/harness";
import { collect } from "@mg/harness";
import { ATTR, SPAN, startRootSpan } from "@mg/trace";
import { createTraceSdk } from "@mg/trace/otel";
import type { OpenWorkspace } from "@mg/workspace";
import { DuplicateToolNameError, openWorkspace } from "@mg/workspace";
import type { RunConfig } from "./config.js";
import { createHarness } from "./harness.js";

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

  let opened: OpenWorkspace | undefined;
  let result: HarnessResult;
  try {
    opened = config.workspace
      ? await openWorkspace(config.workspace, {
          signal: options?.signal,
        })
      : undefined;

    const configTools = config.tools ?? [];
    if (opened) {
      const configToolNames = new Set(
        configTools.map((tool) => tool.name),
      );
      const duplicate = opened.tools.find((tool) =>
        configToolNames.has(tool.name),
      );
      if (duplicate) {
        try {
          await opened.close();
        } catch {
          // The duplicate-name error is the real cause; a close
          // failure that follows it does not replace it.
        }
        throw new DuplicateToolNameError(duplicate.name, [
          "config",
          opened.name,
        ]);
      }
    }
    const tools = opened
      ? [...configTools, ...opened.tools]
      : configTools;

    const harness = createHarness(config, tools);
    const events = tee(
      harness({ messages, signal: options?.signal, trace: root }),
      options?.onEvent,
    );
    result = await collect(events);
    root.end();
  } catch (error) {
    root.end(error);
    try {
      await opened?.close();
    } catch {
      // The run error wins over a close failure that follows it.
    }
    try {
      await sdk.shutdown();
    } catch {
      // The run error wins over a shutdown failure that follows it.
    }
    throw error;
  }

  try {
    await opened?.close();
  } catch (error) {
    try {
      await sdk.shutdown();
    } catch {
      // The close error wins over a shutdown failure that follows it.
    }
    throw error;
  }

  await sdk.shutdown();
  return { sessionId: sdk.sessionId, result };
};
