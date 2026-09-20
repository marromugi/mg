import type { Message } from "@mg/core";
import type {
  HarnessEvent,
  HarnessResult,
  TraceSpan,
} from "@mg/harness";
import { collect, noopSpan } from "@mg/harness";
import { ATTR, jsonAttribute, SPAN, startRootSpan } from "@mg/trace";
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

  let workspaceSpan: TraceSpan = noopSpan;
  if (config.workspace) {
    try {
      workspaceSpan = root.startSpan(SPAN.workspace, {
        [ATTR.op]: "workspace",
        [ATTR.workspaceName]: config.workspace.name,
        [ATTR.workspaceConnectors]: jsonAttribute(
          config.workspace.connectors.map(
            (connector) => connector.kind,
          ),
        ),
      });
    } catch {
      workspaceSpan = noopSpan;
    }
  }

  let opened: OpenWorkspace | undefined;
  const closeWorkspace = async (): Promise<void> => {
    if (!opened) {
      return;
    }
    try {
      await opened.close();
      workspaceSpan.end();
    } catch (error) {
      workspaceSpan.end(error);
      throw error;
    }
  };

  // Read only once `runtimeError` is undefined below, which happens
  // only after this try block ran to completion without throwing.
  let result!: HarnessResult;
  let runtimeError: unknown;
  try {
    opened = config.workspace
      ? await openWorkspace(config.workspace, {
          signal: options?.signal,
        }).catch((error: unknown) => {
          workspaceSpan.end(error);
          throw error;
        })
      : undefined;
    if (opened) {
      workspaceSpan.setAttributes({
        [ATTR.workspaceTools]: jsonAttribute(
          opened.tools.map((tool) => tool.name),
        ),
      });
    }

    const configTools = config.tools ?? [];
    if (opened) {
      const configToolNames = new Set(
        configTools.map((tool) => tool.name),
      );
      const duplicate = opened.tools.find((tool) =>
        configToolNames.has(tool.name),
      );
      if (duplicate) {
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
  } catch (error) {
    runtimeError = error;
  }

  let closeError: unknown;
  try {
    await closeWorkspace();
  } catch (error) {
    closeError = error;
  }

  // `run`'s own error wins over a close failure that follows it.
  const rootError = runtimeError ?? closeError;
  root.end(rootError);

  if (rootError !== undefined) {
    try {
      await sdk.shutdown();
    } catch {
      // The run error wins over a shutdown failure that follows it.
    }
    throw rootError;
  }

  await sdk.shutdown();
  return { sessionId: sdk.sessionId, result };
};
