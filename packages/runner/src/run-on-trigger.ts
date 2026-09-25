import type { Message } from "@mg/core";
import type { HarnessEvent } from "@mg/harness";
import {
  ATTR,
  setSpanAttributes,
  SPAN,
  startRootSpan,
} from "@mg/trace";
import { createTraceSdk } from "@mg/trace/otel";
import type { Trigger, TriggerDecision } from "@mg/trigger";
import { nanoid } from "nanoid";
import type { RecordTraceOptions } from "./record-trace.js";
import type { RunOutcome } from "./run.js";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type StartOptions = {
  sessionId: string;
  signal?: AbortSignal;
  onEvent?: (event: HarnessEvent) => void;
};

export type RunOnTriggerConfig<
  TInput extends JsonValue,
  TMessage extends Message = Message,
  TStarted extends { sessionId: string } = RunOutcome,
> = {
  trigger: Trigger<TInput>;
  toMessages: (input: TInput) => TMessage[];
  start: (
    messages: TMessage[],
    options: StartOptions,
  ) => Promise<TStarted>;
  trace: RecordTraceOptions;
};

export type RunOnTriggerOptions = {
  signal?: AbortSignal;
  onEvent?: (event: HarnessEvent) => void;
};

export type RunOnTriggerOutcome<TStarted> =
  | { fired: false; sessionId: string; decision: TriggerDecision }
  | {
      fired: true;
      referenced: true;
      sessionId: string;
      decision: TriggerDecision;
      run: TStarted;
    }
  | {
      fired: true;
      referenced: false;
      sessionId: string;
      decision: TriggerDecision;
      expectedRunSessionId: string;
      run: TStarted;
    };

export const runOnTrigger = async <
  TInput extends JsonValue,
  TMessage extends Message = Message,
  TStarted extends { sessionId: string } = RunOutcome,
>(
  config: RunOnTriggerConfig<TInput, TMessage, TStarted>,
  input: TInput,
  options?: RunOnTriggerOptions,
): Promise<RunOnTriggerOutcome<TStarted>> => {
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

  let messages: TMessage[];
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

  const started = await config.start(messages, {
    sessionId: runSessionId,
    signal: options?.signal,
    onEvent: options?.onEvent,
  });

  if (started.sessionId === runSessionId) {
    return {
      fired: true,
      referenced: true,
      sessionId: sdk.sessionId,
      decision,
      run: started,
    };
  }

  return {
    fired: true,
    referenced: false,
    sessionId: sdk.sessionId,
    decision,
    expectedRunSessionId: runSessionId,
    run: started,
  };
};
