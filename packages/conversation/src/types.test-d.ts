import { EntryNotJsonError, EntryToolPairingError } from "./errors.js";
import type {
  ConversationEntry,
  ConversationMessage,
  ConversationStore,
} from "./types.js";

const systemMessage = { role: "system", content: "x" } as const;

// @ts-expect-error a system message is not a conversation message
export const systemAsConversationMessage: ConversationMessage =
  systemMessage;

// @ts-expect-error an entry needs at least one message
export const emptyEntry: ConversationEntry = { messages: [] };

declare const store: ConversationStore;

// @ts-expect-error read needs a range
void store.read("a");

export const invalidToolPairingErrorKind = new EntryToolPairingError(
  // @ts-expect-error kind must be one of the tool pairing error's own kinds
  "x",
  "c1",
);

export const invalidNotJsonErrorKind = new EntryNotJsonError(
  // @ts-expect-error kind must be one of the not-json error's own kinds
  "x",
  "p",
);
