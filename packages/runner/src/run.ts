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
  let workspaceSpanEnded = false;
  const endWorkspaceSpan = (error?: unknown): void => {
    if (workspaceSpanEnded) {
      return;
    }
    workspaceSpanEnded = true;
    workspaceSpan.end(error);
  };
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
      endWorkspaceSpan();
    } catch (error) {
      endWorkspaceSpan(error);
      throw error;
    }
  };

  let result: HarnessResult;
  try {
    opened = config.workspace
      ? await openWorkspace(config.workspace, {
          signal: options?.signal,
        })
          .then((openedWorkspace) => {
            workspaceSpan.setAttributes({
              [ATTR.workspaceTools]: jsonAttribute(
                openedWorkspace.tools.map((tool) => tool.name),
              ),
            });
            return openedWorkspace;
          })
          .catch((error: unknown) => {
            endWorkspaceSpan(error);
            throw error;
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
          await closeWorkspace();
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
      await closeWorkspace();
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
    await closeWorkspace();
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
