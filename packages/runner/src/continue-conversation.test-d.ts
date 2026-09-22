import type {
  ConversationMessage,
  ConversationStore,
  ReadRange,
} from "@mg/conversation";
import type {
  ContinueOutcome,
  ConversationTarget,
} from "./continue-conversation.js";

declare const store: ConversationStore;
declare const history: ReadRange;
const message: ConversationMessage = { role: "user", content: "hi" };

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

export const targetWithSystemAmongMessages: ConversationTarget = {
  store,
  id: "jev",
  history,
  // @ts-expect-error a system message cannot be one of the new messages
  messages: [{ role: "system", content: "x" }],
};

declare const outcome: ContinueOutcome;

// @ts-expect-error `reason` only exists once `saved` narrows to false
export const reasonWithoutNarrowing = outcome.reason;
