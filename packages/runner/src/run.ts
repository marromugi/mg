import type { Message, Tool } from "@mg/core";
import type {
  HarnessEvent,
  HarnessResult,
  HoldSignal,
} from "@mg/harness";
import { collect } from "@mg/harness";
import { ATTR, SPAN, startRootSpan } from "@mg/trace";
import { createTraceSdk } from "@mg/trace/otel";
import { exclusiveNamesOf } from "@mg/workspace";
import type { GatedRunConfig, RunConfig } from "./config.js";
import { requireGates } from "./require-gate.js";
import { createExclusiveNames } from "./exclusive-names.js";
import { createHarness } from "./harness.js";
import { createSubagent } from "./subagent.js";
import { mergeCallTools, withWorkspace } from "./workspace-scope.js";

export type RunOptions = {
  signal?: AbortSignal;
  wrapUp?: AbortSignal;
  hold?: HoldSignal;
  tools?: readonly Tool[];
  sessionId?: string;
  caseId?: string;
  onEvent?: (event: HarnessEvent) => void;
};

export type UngatedRunOptions = Omit<RunOptions, "tools"> & {
  tools?: undefined;
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

export function run(
  config: GatedRunConfig,
  messages: Message[],
  options?: RunOptions,
): Promise<RunOutcome>;
export function run(
  config: RunConfig,
  messages: Message[],
  options?: UngatedRunOptions,
): Promise<RunOutcome>;
export async function run(
  config: RunConfig,
  messages: Message[],
  options?: RunOptions,
): Promise<RunOutcome> {
  requireGates(config, options?.tools);

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
        const tools = mergeCallTools(
          config.tools ?? [],
          opened,
          options?.tools ?? [],
        );
        const exclusiveNames = createExclusiveNames();
        const parentExclusiveNames = config.workspace
          ? exclusiveNamesOf(config.workspace)
          : [];
        const subagents = (config.subagents ?? []).map(
          (subagentConfig) =>
            createSubagent(subagentConfig, {
              parent: opened,
              exclusive: exclusiveNames,
              parentExclusiveNames,
            }),
        );
        const harness = createHarness(
          config.harness,
          config.provider,
          config.gate,
          tools,
          subagents,
        );
        const events = tee(
          harness({
            messages,
            signal: options?.signal,
            wrapUp: options?.wrapUp,
            hold: options?.hold,
            trace: root,
          }),
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
}

export type RunEntry = typeof run;
