import { EntryNotJsonError, EntryToolPairingError } from "./errors.js";
import type { ConversationEntry, ConversationStore } from "./types.js";

export const systemAsEntryMessage: ConversationEntry["messages"][number] =
  { role: "system", content: "x" };

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
