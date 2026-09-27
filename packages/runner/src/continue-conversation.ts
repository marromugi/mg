import type { Message } from "@mg/core";
import type {
  ConversationEntry,
  ConversationStore,
  ReadRange,
} from "@mg/conversation";
import type { HarnessResult } from "@mg/harness";
import { addedMessages } from "./added-messages.js";
import type { GatedRunConfig, RunConfig } from "./config.js";
import { GateRequiredError } from "./errors.js";
import { keptMessages } from "./kept-messages.js";
import { run } from "./run.js";
import type { RunEntry, RunOptions } from "./run.js";

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

export type UngatedContinueOptions = Omit<ContinueOptions, "tools"> & {
  tools?: undefined;
};

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

export const createContinueConversation = (deps: { run: RunEntry }) => {
  function continueConversation(
    config: GatedRunConfig,
    conversation: ConversationTarget,
    options?: ContinueOptions,
  ): Promise<ContinueOutcome>;
  function continueConversation(
    config: RunConfig,
    conversation: ConversationTarget,
    options?: UngatedContinueOptions,
  ): Promise<ContinueOutcome>;
  async function continueConversation(
    config: RunConfig,
    conversation: ConversationTarget,
    options?: ContinueOptions,
  ): Promise<ContinueOutcome> {
    options?.signal?.throwIfAborted();

    if (config.gate === undefined) {
      if (
        config.tools !== undefined ||
        config.workspace !== undefined
      ) {
        throw new GateRequiredError("means");
      }
      if (options?.tools !== undefined) {
        throw new GateRequiredError("added-tools");
      }
    }

    const slice = await conversation.store.read(
      conversation.id,
      conversation.history,
    );

    const built: Message[] = [
      ...slice.entries.flatMap((entry) => entry.messages),
      ...conversation.messages,
    ];

    const opts: ContinueOptions = options ?? {};
    const { keep: _keep, ...rest } = opts;
    const { sessionId, result } = await (config.gate !== undefined
      ? deps.run(config, built, rest)
      : (() => {
          const { tools, ...ungated } = rest;
          if (tools !== undefined) {
            throw new GateRequiredError("added-tools");
          }
          return deps.run(config, built, ungated);
        })());

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
  }

  return continueConversation;
};

export type ContinueEntry = ReturnType<
  typeof createContinueConversation
>;

export const continueConversation = createContinueConversation({ run });
