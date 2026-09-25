import type { Message } from "@mg/core";
import type {
  ConversationEntry,
  ConversationStore,
  ReadRange,
} from "@mg/conversation";
import type { HarnessResult } from "@mg/harness";
import { addedMessages } from "./added-messages.js";
import type { RunConfig } from "./config.js";
import { keptMessages } from "./kept-messages.js";
import { run } from "./run.js";
import type { RunOptions, RunOutcome } from "./run.js";

export type ConversationTarget = {
  store: ConversationStore;
  id: string;
  history: ReadRange;
  messages: [Message, ...Message[]];
};

export type KeepMessages = (
  added: readonly Message[],
) => Message[] | Promise<Message[]>;

export type ContinueOptions = RunOptions & { keep?: KeepMessages };

export type NotSavedReason =
  | { kind: "diverged" }
  | { kind: "not-in-result" }
  | { kind: "keep-failed"; error: unknown }
  | { kind: "append-failed"; error: unknown };

export type ContinueOutcome =
  | {
      saved: true;
      sessionId: string;
      result: HarnessResult;
      entry: ConversationEntry;
    }
  | {
      saved: false;
      sessionId: string;
      result: HarnessResult;
      reason: NotSavedReason;
    };

export const createContinueConversation = (deps: {
  run: (
    config: RunConfig,
    messages: Message[],
    options?: RunOptions,
  ) => Promise<RunOutcome>;
}) => {
  return async (
    config: RunConfig,
    conversation: ConversationTarget,
    options?: ContinueOptions,
  ): Promise<ContinueOutcome> => {
    options?.signal?.throwIfAborted();

    const slice = await conversation.store.read(
      conversation.id,
      conversation.history,
    );

    const built: Message[] = [
      ...slice.entries.flatMap((entry) => entry.messages),
      ...conversation.messages,
    ];

    const runOptions: RunOptions | undefined =
      options && "keep" in options
        ? (({ keep: _keep, ...rest }) => rest)(options)
        : options;

    const { sessionId, result } = await deps.run(
      config,
      built,
      runOptions,
    );

    const added = addedMessages(built, result.messages);
    if (added.kind === "diverged") {
      return {
        saved: false,
        sessionId,
        result,
        reason: { kind: "diverged" },
      };
    }

    let kept: Message[];
    if (options?.keep) {
      let answer: Message[];
      try {
        answer = await options.keep(structuredClone(added.messages));
      } catch (error) {
        return {
          saved: false,
          sessionId,
          result,
          reason: { kind: "keep-failed", error },
        };
      }
      if (!keptMessages(added.messages, answer)) {
        return {
          saved: false,
          sessionId,
          result,
          reason: { kind: "not-in-result" },
        };
      }
      kept = answer;
    } else {
      kept = added.messages;
    }

    const entry: ConversationEntry = {
      messages: [
        conversation.messages[0],
        ...conversation.messages.slice(1),
        ...kept,
      ],
    };

    try {
      await conversation.store.append(
        conversation.id,
        entry,
        slice.length,
      );
    } catch (error) {
      return {
        saved: false,
        sessionId,
        result,
        reason: { kind: "append-failed", error },
      };
    }

    return { saved: true, sessionId, result, entry };
  };
};

export const continueConversation = createContinueConversation({ run });
