import type { Message } from "@mg/core";
import { createOpenRouterProvider } from "@mg/core";
import type { ConversationStore } from "@mg/conversation";
import { createMemoryConversationStore } from "@mg/conversation";
import type {
  DialogueEvent,
  DialogueOptions,
  Talker,
  WorkEnding,
  Worker,
  WorkRequestOptions,
  WorkTriggerInput,
} from "@mg/dialogue";
import { TalkerError } from "@mg/dialogue";
import { createEstimatorGate } from "@mg/gate";
import type { HarnessStopReason, TraceSpan } from "@mg/harness";
import type {
  ContinueOutcome,
  GatedRunConfig,
  NotSavedReason,
  UngatedRunConfig,
} from "@mg/runner";
import {
  continueConversation,
  createRunQueue,
  defineRun,
  keepDelivered,
} from "@mg/runner";
import { startRootSpan } from "@mg/trace";
import { createTraceSdk } from "@mg/trace/otel";
import { createBashTool } from "@mg/tools";
import type { TextTriggerInput, Trigger } from "@mg/trigger";
import { createEstimatorTrigger } from "@mg/trigger";
import type { Exchange } from "@mg/turn";
import {
  createEstimatorRedirectJudge,
  createEstimatorReportJudge,
  createEstimatorStopJudge,
} from "@mg/turn";
import {
  createGeminiSynthesizer,
  createGeminiTranscriber,
} from "@mg/voice";
import { createSampleJevEstimator } from "./jev-estimator.ts";
import { outputPath } from "./outputs.ts";
import {
  exchangesText,
  judgeWording,
  synthesizerLanguage,
  synthesizerVoice,
  triggerQuestion,
  triggerThreshold,
  workerPolicy,
} from "./voice-dialogue.values.ts";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const describeNotSaved = (reason: NotSavedReason): string =>
  reason.kind === "keep-failed" || reason.kind === "append-failed"
    ? `${reason.kind}: ${messageOf(reason.error)}`
    : reason.kind;

const isLimit = (reason: HarnessStopReason | undefined): boolean =>
  reason === "length" || reason === "max-turns";

const untilAborted = <T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });

export const createTalker = ({
  config,
  store,
  id,
}: {
  config: UngatedRunConfig;
  store: ConversationStore;
  id: string;
}): Talker => ({
  async reply(message, options) {
    let stopReason: HarnessStopReason | undefined;

    let outcome: ContinueOutcome;
    try {
      outcome = await continueConversation(
        config,
        {
          store,
          id,
          history: { kind: "all" },
          messages: [{ role: "user", content: message }],
        },
        {
          signal: options.signal,
          wrapUp: options.wrapUp,
          onEvent: (event) => {
            if (event.type === "text-delta")
              options.onText(event.delta);
            else if (event.type === "done") {
              stopReason = event.result.reason;
            }
          },
          keep: async (added) => {
            if (isLimit(stopReason)) {
              throw new Error(`the reply ended at ${stopReason}`);
            }
            if (stopReason === "stop") options.onTextEnd();
            const heard = await untilAborted(
              options.heard,
              options.signal,
            );
            if (!added.some((m) => m.role === "assistant"))
              return [...added];
            return keepDelivered(added, {
              kind: "until",
              turn: 0,
              end: heard,
            });
          },
        },
      );
    } catch (error) {
      if (options.signal.aborted) throw error;
      throw new TalkerError(messageOf(error), { cause: error });
    }

    if (isLimit(stopReason)) {
      throw new TalkerError(`the reply ended at ${stopReason}`);
    }
    if (!outcome.saved) {
      if (options.signal.aborted) throw options.signal.reason;
      throw new TalkerError(
        `the reply was not saved: ${describeNotSaved(outcome.reason)}`,
      );
    }
    return { sessionId: outcome.sessionId };
  },
});

type WorkInput = { text: string; options: WorkRequestOptions };

const lastReplyText = (messages: readonly Message[]): string => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    return message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("");
  }
  return "";
};

export const createWorker = ({
  config,
  store,
  id,
}: {
  config: GatedRunConfig;
  store: ConversationStore;
  id: string;
}): Worker => {
  const queue = createRunQueue<WorkInput, ContinueOutcome>(
    (input, run) => {
      input.options.onStart(run.sessionId);
      return continueConversation(
        config,
        {
          store,
          id,
          history: { kind: "all" },
          messages: [{ role: "user", content: input.text }],
        },
        {
          signal: input.options.signal,
          wrapUp: run.wrapUp,
          hold: run.hold,
          sessionId: run.sessionId,
          onEvent: input.options.onEvent,
        },
      );
    },
  );

  return {
    async request(text, options): Promise<WorkEnding> {
      const ending = await queue.enqueue({ text, options }).ending;
      if (ending.kind === "failed") {
        return { kind: "failed", reason: messageOf(ending.error) };
      }
      if (ending.kind === "dropped") {
        return { kind: "failed", reason: "the work queue was closed" };
      }
      const { outcome } = ending;
      if (!outcome.saved) {
        return {
          kind: "failed",
          reason: `the run was not saved: ${describeNotSaved(outcome.reason)}`,
        };
      }
      return {
        kind: "ended",
        reason: outcome.result.reason,
        text: lastReplyText(outcome.result.messages),
        sessionId: outcome.sessionId,
      };
    },
    hold: () => queue.hold(),
    release: () => queue.release(),
    wrapUp: () => {
      queue.wrapUp();
    },
  };
};

export const createWorkTrigger = ({
  trigger,
  text,
}: {
  trigger: Trigger<TextTriggerInput>;
  text: (exchanges: Exchange[]) => string;
}): Trigger<WorkTriggerInput> => ({
  decide: (input, context) =>
    trigger.decide(
      { kind: "exchanges", text: text(input.exchanges) },
      context,
    ),
});

export const printEvent =
  (out: (line: string) => void, err: (line: string) => void) =>
  (event: DialogueEvent): void => {
    switch (event.type) {
      case "transcript":
        if (event.final) out(`you: ${event.text}`);
        break;
      case "reply":
        out(`talker: ${event.text}`);
        break;
      case "work":
        out(`work: ${event.action}`);
        break;
      case "judgment":
        out(`judge ${event.judge}: ${event.answer}`);
        break;
      case "failure":
        err(`failed ${event.what}: ${event.reason}`);
        break;
      default:
        break;
    }
  };

export type TraceWriter = {
  span: TraceSpan;
  close(): Promise<void>;
};

export const createTraceWriter = async ({
  name,
  jsonlPath,
}: {
  name: string;
  jsonlPath: string;
}): Promise<TraceWriter> => {
  const sdk = await createTraceSdk({ jsonlPath });
  const span = startRootSpan(sdk.tracer, name);
  return {
    span,
    close: async () => {
      span.end();
      await sdk.shutdown();
    },
  };
};

export type DialogueCollaborators = Pick<
  DialogueOptions,
  | "transcriber"
  | "synthesizer"
  | "judges"
  | "workTrigger"
  | "talker"
  | "worker"
>;

const TALKER_ID = "talker";
const WORK_ID = "work";

export const createDialogueCollaborators = async (keys: {
  geminiApiKey: string;
  openRouterApiKey: string;
  typesafeApiKey: string;
}): Promise<DialogueCollaborators> => {
  const estimator = createSampleJevEstimator({
    apiKey: keys.typesafeApiKey,
  });
  const provider = createOpenRouterProvider({
    apiKey: keys.openRouterApiKey,
  });
  const harness = {
    kind: "loop",
    model: "deepseek/deepseek-v4-flash",
    maxTurns: 10,
  } as const;
  const trace = { jsonlPath: outputPath("voice-dialogue-runs.jsonl") };

  const store = createMemoryConversationStore();
  await store.create(TALKER_ID);
  await store.create(WORK_ID);

  return {
    transcriber: createGeminiTranscriber({ apiKey: keys.geminiApiKey }),
    synthesizer: createGeminiSynthesizer({
      apiKey: keys.geminiApiKey,
      voice: synthesizerVoice,
      language: synthesizerLanguage,
    }),
    judges: {
      stop: createEstimatorStopJudge({
        estimator,
        ...judgeWording.stop,
      }),
      redirect: createEstimatorRedirectJudge({
        estimator,
        ...judgeWording.redirect,
      }),
      report: createEstimatorReportJudge({
        estimator,
        ...judgeWording.report,
      }),
    },
    workTrigger: createWorkTrigger({
      trigger: createEstimatorTrigger({
        estimator,
        question: triggerQuestion,
        threshold: triggerThreshold,
      }),
      text: exchangesText,
    }),
    talker: createTalker({
      config: defineRun({
        name: "voice-dialogue-talker",
        provider,
        harness,
        trace,
      }),
      store,
      id: TALKER_ID,
    }),
    worker: createWorker({
      config: defineRun({
        name: "voice-dialogue-worker",
        provider,
        harness,
        tools: [createBashTool({ cwd: process.cwd() })],
        gate: createEstimatorGate({
          estimator,
          policy: workerPolicy,
        }),
        trace,
      }),
      store,
      id: WORK_ID,
    }),
  };
};
