import type { Message } from "@mg/core";
import type { ConversationStore, ReadRange } from "@mg/conversation";
import type {
  ContinueOptions,
  ContinueOutcome,
  ConversationTarget,
  KeepMessages,
} from "./continue-conversation.js";

declare const store: ConversationStore;
declare const history: ReadRange;
const message: Message = { role: "user", content: "hi" };

// @ts-expect-error a conversation target needs a read range
export const targetWithoutHistory: ConversationTarget = {
  store,
  id: "jev",
  messages: [message],
};

export const targetWithNoMessages: ConversationTarget = {
  store,
  id: "jev",
  history,
  // @ts-expect-error a conversation target needs at least one new message
  messages: [],
};

export const targetWithSystemArgument: ConversationTarget = {
  store,
  id: "jev",
  history,
  // @ts-expect-error a conversation target has no system argument
  system: "x",
  messages: [message],
};

declare const outcome: ContinueOutcome;

// @ts-expect-error `reason` only exists once `saved` narrows to false
export const reasonWithoutNarrowing = outcome.reason;

// @ts-expect-error `entry` only exists once `saved` narrows to true
export const entryWithoutNarrowing = outcome.entry;

if (!outcome.saved) {
  if (outcome.reason.kind === "keep-failed") {
    const error: unknown = outcome.reason.error;
    void error;
  } else if (outcome.reason.kind === "not-in-result") {
    // @ts-expect-error `not-in-result` carries no `error`
    void outcome.reason.error;
  }
}

declare const keep: KeepMessages;

export const optionsWithKeep: ContinueOptions = { keep };

export const keepReturningWrongType: KeepMessages = () =>
  // @ts-expect-error a keep function must return messages, not a string
  "not messages";
