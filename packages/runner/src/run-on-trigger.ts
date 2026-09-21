import type { Message } from "@mg/core";
import type { HarnessEvent } from "@mg/harness";
import {
  ATTR,
  setSpanAttributes,
  SPAN,
  startRootSpan,
} from "@mg/trace";
import { createTraceSdk } from "@mg/trace/otel";
import type { TraceSdkOptions } from "@mg/trace/otel";
import type { Trigger, TriggerDecision } from "@mg/trigger";
import { nanoid } from "nanoid";
import type { RunConfig } from "./config.js";
import type { RunOutcome } from "./run.js";
import { run } from "./run.js";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type TraceExporter = NonNullable<TraceSdkOptions["exporters"]>[number];

export type TriggerTraceOptions = Omit<TraceSdkOptions, "sessionId"> &
  (
    | { jsonlPath: string }
    | { sqlitePath: string }
    | { exporters: [TraceExporter, ...TraceExporter[]] }
  );

export type RunOnTriggerConfig<TInput extends JsonValue> = {
  trigger: Trigger<TInput>;
  run: RunConfig;
  toMessages: (input: TInput) => Message[];
  trace: TriggerTraceOptions;
};

export type RunOnTriggerOptions = {
  signal?: AbortSignal;
  onEvent?: (event: HarnessEvent) => void;
};

export type RunOnTriggerOutcome =
  | { fired: false; sessionId: string; decision: TriggerDecision }
  | {
      fired: true;
      sessionId: string;
      decision: TriggerDecision;
      run: RunOutcome;
    };

export const runOnTrigger = async <TInput extends JsonValue>(
  config: RunOnTriggerConfig<TInput>,
  input: TInput,
  options?: RunOnTriggerOptions,
): Promise<RunOnTriggerOutcome> => {
  const inputValue = JSON.stringify(input);
  const sdk = await createTraceSdk(config.trace);
  const root = startRootSpan(sdk.tracer, SPAN.input, {
    [ATTR.op]: "input",
    [ATTR.inputValue]: inputValue,
  });

  let decision: TriggerDecision;
  try {
    decision = await config.trigger.decide(input, {
      signal: options?.signal,
      trace: root,
    });
  } catch (error) {
    root.end(error);
    try {
      await sdk.shutdown();
    } catch {
      // The trigger's failure wins over a shutdown failure that follows it.
    }
    throw error;
  }

  if (!decision.fired) {
    root.end();
    await sdk.shutdown();
    return { fired: false, sessionId: sdk.sessionId, decision };
  }

  let messages: Message[];
  try {
    messages = config.toMessages(input);
  } catch (error) {
    root.end(error);
    try {
      await sdk.shutdown();
    } catch {
      // The converter's failure wins over a shutdown failure that follows it.
    }
    throw error;
  }

  const runSessionId = nanoid();
  setSpanAttributes(root, { [ATTR.runSession]: runSessionId });
  root.end();
  await sdk.shutdown();

  const runOutcome = await run(config.run, messages, {
    sessionId: runSessionId,
    signal: options?.signal,
    onEvent: options?.onEvent,
  });

  return {
    fired: true,
    sessionId: sdk.sessionId,
    decision,
    run: runOutcome,
  };
};
