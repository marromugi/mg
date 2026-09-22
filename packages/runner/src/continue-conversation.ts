import type { Message } from "@mg/core";
import type {
  ConversationMessage,
  ConversationStore,
  ReadRange,
} from "@mg/conversation";
import type { HarnessResult } from "@mg/harness";
import { addedMessages } from "./added-messages.js";
import type { RunConfig } from "./config.js";
import { run } from "./run.js";
import type { RunOptions, RunOutcome } from "./run.js";

export type ConversationTarget = {
  store: ConversationStore;
  id: string;
  history: ReadRange;
  system?: string;
  messages: [ConversationMessage, ...ConversationMessage[]];
};

export type NotSavedReason =
  { kind: "diverged" } | { kind: "append-failed"; error: unknown };

export type ContinueOutcome =
  | { saved: true; sessionId: string; result: HarnessResult }
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
    options?: RunOptions,
  ): Promise<ContinueOutcome> => {
    options?.signal?.throwIfAborted();

    const slice = await conversation.store.read(
      conversation.id,
      conversation.history,
    );

    const built: Message[] = [
      ...(conversation.system !== undefined
        ? [{ role: "system" as const, content: conversation.system }]
        : []),
      ...slice.entries.flatMap((entry) => entry.messages),
      ...conversation.messages,
    ];

    const { sessionId, result } = await deps.run(
      config,
      built,
      options,
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

    try {
      await conversation.store.append(
        conversation.id,
        {
          messages: [
            conversation.messages[0],
            ...conversation.messages.slice(1),
            ...added.messages,
          ],
        },
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

    return { saved: true, sessionId, result };
  };
};

export const continueConversation = createContinueConversation({ run });
