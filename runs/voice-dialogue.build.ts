import type { Estimator, Message, Provider } from "@mg/core";
import type { ConversationStore } from "@mg/conversation";
import type {
  DialogueEvent,
  DialogueOptions,
  Talker,
  WorkEnding,
  WorkRequestOptions,
  WorkTriggerInput,
  Worker,
} from "@mg/dialogue";
import { TalkerError } from "@mg/dialogue";
import { createEstimatorGate } from "@mg/gate";
import type { HarnessStopReason, TraceSpan } from "@mg/harness";
import type { Counterpart, Persona } from "@mg/persona";
import {
  continueAsPersonaDetached,
  continueConversation,
  createRunQueue,
  defineRun,
  keepDelivered,
} from "@mg/runner";
import type {
  ContinueOutcome,
  GatedRunConfig,
  MemoryOutcome,
  DetachedPersonaOutcome,
  NotSavedReason,
  RunConfig,
  UngatedRunConfig,
} from "@mg/runner";
import { createBashTool } from "@mg/tools";
import { startRootSpan } from "@mg/trace";
import { createTraceSdk } from "@mg/trace/otel";
import type { TextTriggerInput, Trigger } from "@mg/trigger";
import { createEstimatorTrigger } from "@mg/trigger";
import {
  createEstimatorRedirectJudge,
  createEstimatorReportJudge,
  createEstimatorStopJudge,
} from "@mg/turn";
import type { Exchange } from "@mg/turn";
import type { SpeechSynthesizer, Transcriber } from "@mg/voice";
import type { ReflectionQueue } from "./voice-dialogue.memory.ts";
import {
  EXCHANGE_COUNT,
  LANGUAGES,
  REQUEST_LIMIT,
  STOP_CHECK_MS,
  TRIGGER_THRESHOLD,
  exchangesText,
  questions,
  talkerInstruction,
  wording,
  workerQuestion,
} from "./voice-dialogue.values.ts";

const MODEL = "deepseek/deepseek-v4-flash";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const describeNotSaved = (reason: NotSavedReason): string => {
  if (
    reason.kind === "keep-failed" ||
    reason.kind === "append-failed"
  ) {
    return `${reason.kind}: ${messageOf(reason.error)}`;
  }
  return reason.kind;
};

export const createTalkerConfig = (options: {
  provider: Provider;
  jsonlPath: string;
}): UngatedRunConfig =>
  defineRun({
    name: "voice-dialogue-talker",
    provider: options.provider,
    harness: { kind: "loop", model: MODEL, maxTurns: 10 },
    trace: { jsonlPath: options.jsonlPath },
  });

export const createWorkerConfig = (options: {
  provider: Provider;
  estimator: Estimator;
  jsonlPath: string;
}): GatedRunConfig =>
  defineRun({
    name: "voice-dialogue-worker",
    provider: options.provider,
    harness: { kind: "loop", model: MODEL, maxTurns: 10 },
    tools: [createBashTool({ cwd: process.cwd() })],
    gate: createEstimatorGate({
      estimator: options.estimator,
      question: workerQuestion,
    }),
    trace: { jsonlPath: options.jsonlPath },
  });

type Conversation = {
  config: RunConfig;
  store: ConversationStore;
  id: string;
};

const keepHeard = (added: readonly Message[], heard: number) =>
  added.some((message) => message.role === "assistant")
    ? keepDelivered(added, { kind: "until", turn: 0, end: heard })
    : [...added];

export type TalkerPersona<TRead> = {
  persona: Persona<string, TRead>;
  counterparts: readonly Counterpart[];
  tracePath: string;
  reflections: ReflectionQueue;
  // called with what the persona's reflection did after each saved reply
  onMemory(memory: MemoryOutcome<TRead>): void;
};

// Replies as the persona: it recalls before each reply and reflects on
// the part the person heard after it. The reply settles once it is saved;
// the reflection runs on, and the next recall waits for it. A failed
// recall rejects the reply.
export const createTalker = <TRead>(
  talker: Conversation & TalkerPersona<TRead>,
): Talker => {
  const { config, store, id, persona, counterparts, tracePath } =
    talker;
  const { reflections } = talker;
  return {
    async reply(message, options) {
      const ended: { reason?: HarnessStopReason } = {};
      await reflections.idle();
      let outcome: DetachedPersonaOutcome<TRead>;
      try {
        outcome = await continueAsPersonaDetached(
          config,
          {
            store,
            id,
            history: { kind: "all" },
            messages: [{ role: "user", content: message }],
          },
          {
            persona,
            counterparts,
            input: message,
            trace: { jsonlPath: tracePath },
          },
          {
            signal: options.signal,
            wrapUp: options.wrapUp,
            onEvent: (event) => {
              if (event.type === "text-delta")
                options.onText(event.delta);
              else if (event.type === "done") {
                ended.reason = event.result.reason;
              }
            },
            keep: async (added) => {
              if (ended.reason === "stop") {
                options.onTextEnd();
              } else if (ended.reason !== "wrapped-up") {
                throw new TalkerError(
                  `the reply ended with stop reason ${ended.reason}`,
                );
              }
              return keepHeard(added, await options.heard);
            },
          },
        );
      } catch (error) {
        if (error instanceof TalkerError) throw error;
        throw new TalkerError(messageOf(error), { cause: error });
      }
      if (!outcome.saved) {
        const { reason } = outcome;
        if (
          reason.kind === "keep-failed" &&
          reason.error instanceof TalkerError
        ) {
          throw reason.error;
        }
        throw new TalkerError(
          `the reply was not saved (${describeNotSaved(reason)})`,
        );
      }
      reflections.add(
        outcome.reflection.then(({ memory }) => {
          talker.onMemory(memory);
        }),
      );
      return { sessionId: outcome.sessionId };
    },
  };
};

type WorkJob = { text: string; options: WorkRequestOptions };

const lastReplyText = (messages: readonly Message[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant") {
      return message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("");
    }
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
  const queue = createRunQueue<WorkJob, ContinueOutcome>((job, run) => {
    job.options.onStart(run.sessionId);
    return continueConversation(
      config,
      {
        store,
        id,
        history: { kind: "all" },
        messages: [{ role: "user", content: job.text }],
      },
      {
        signal: job.options.signal,
        sessionId: run.sessionId,
        wrapUp: run.wrapUp,
        hold: run.hold,
        onEvent: (event) => {
          run.onEvent(event);
          job.options.onEvent(event);
        },
      },
    );
  });
  return {
    async request(text, options): Promise<WorkEnding> {
      const { ending } = queue.enqueue({ text, options });
      const settled = await ending;
      if (settled.kind === "dropped") {
        return { kind: "failed", reason: "the work queue was closed" };
      }
      if (settled.kind === "failed") {
        return { kind: "failed", reason: messageOf(settled.error) };
      }
      const { outcome } = settled;
      if (!outcome.saved) {
        return {
          kind: "failed",
          reason: `the work was not saved (${describeNotSaved(outcome.reason)})`,
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

export type DialogueCollaboratorInputs = {
  transcriber: Transcriber;
  synthesizer: SpeechSynthesizer;
  estimator: Estimator;
  talker: Conversation & TalkerPersona<unknown>;
  worker: {
    config: GatedRunConfig;
    store: ConversationStore;
    id: string;
  };
  // defaults to the wording of the entries
  talkerInstruction?: string;
};

export type DialogueCollaborators = Omit<
  DialogueOptions,
  "listener" | "player"
>;

// Creates both conversations, seeds the talker's with its instruction as
// the one system message, and builds everything the dialogue takes except
// the listener and the player.
export const createDialogueCollaborators = async (
  inputs: DialogueCollaboratorInputs,
): Promise<DialogueCollaborators> => {
  const { estimator, talker, worker } = inputs;
  await talker.store.create(talker.id);
  await talker.store.append(
    talker.id,
    {
      messages: [
        {
          role: "system",
          content: inputs.talkerInstruction ?? talkerInstruction,
        },
      ],
    },
    0,
  );
  await worker.store.create(worker.id);
  return {
    transcriber: inputs.transcriber,
    languages: LANGUAGES,
    synthesizer: inputs.synthesizer,
    judges: {
      stop: createEstimatorStopJudge({ estimator, ...questions.stop }),
      redirect: createEstimatorRedirectJudge({
        estimator,
        ...questions.redirect,
      }),
      report: createEstimatorReportJudge({
        estimator,
        ...questions.report,
      }),
    },
    workTrigger: createWorkTrigger({
      trigger: createEstimatorTrigger({
        estimator,
        question: questions.trigger,
        threshold: TRIGGER_THRESHOLD,
      }),
      text: exchangesText,
    }),
    talker: createTalker(talker),
    worker: createWorker(worker),
    wording,
    stopCheckMs: STOP_CHECK_MS,
    exchangeCount: EXCHANGE_COUNT,
    requestLimit: REQUEST_LIMIT,
  };
};

export const printEvent =
  (out: (line: string) => void, err: (line: string) => void) =>
  (event: DialogueEvent): void => {
    switch (event.type) {
      case "utterance":
        out("utterance: started");
        return;
      case "utterance-end":
        out("utterance: ended");
        return;
      case "transcript":
        if (event.final) out(`you: ${event.text}`);
        return;
      case "reply":
        out(`talker: ${event.text}`);
        return;
      case "work":
        out(`work: ${event.action}`);
        return;
      case "judgment":
        out(`judge ${event.judge}: ${event.answer}`);
        return;
      case "failure":
        err(`failed ${event.what}: ${event.reason}`);
        return;
      default:
        return;
    }
  };

// The trace of one dialogue session: the parent span the session hangs
// its cycles under, and the close that writes it out.
export type SessionTrace = {
  path: string;
  span: TraceSpan;
  close(): Promise<void>;
};

export const openSessionTrace = async (
  jsonlPath: string,
  name: string,
): Promise<SessionTrace> => {
  const sdk = await createTraceSdk({ jsonlPath });
  const root = startRootSpan(sdk.tracer, name);
  return {
    path: jsonlPath,
    span: root,
    close: async () => {
      root.end();
      await sdk.shutdown();
    },
  };
};
