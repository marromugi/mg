import type { Message } from "@mg/core";
import type { ConversationStore, ReadRange } from "@mg/conversation";
import type {
  ContinueOutcome,
  ConversationTarget,
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
