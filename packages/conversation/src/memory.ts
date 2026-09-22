import { assertJsonEntry, assertToolPairing } from "./checks.js";
import {
  ConversationConflictError,
  ConversationExistsError,
  ConversationNotFoundError,
  ConversationRangeError,
} from "./errors.js";
import type {
  ConversationEntry,
  ConversationSlice,
  ConversationStore,
  ReadRange,
} from "./types.js";

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0;

export const createMemoryConversationStore = (): ConversationStore => {
  const conversations = new Map<string, ConversationEntry[]>();

  const create = async (id: string): Promise<void> => {
    if (conversations.has(id)) {
      throw new ConversationExistsError(id);
    }
    conversations.set(id, []);
  };

  const read = async (
    id: string,
    range: ReadRange,
  ): Promise<ConversationSlice> => {
    if (range.kind === "last" && !isPositiveInteger(range.count)) {
      throw new ConversationRangeError(range.count);
    }

    const entries = conversations.get(id);
    if (entries === undefined) {
      throw new ConversationNotFoundError(id);
    }

    const sliced =
      range.kind === "all" ? entries : entries.slice(-range.count);

    return { entries: structuredClone(sliced), length: entries.length };
  };

  const append = async (
    id: string,
    entry: ConversationEntry,
    expectedLength: number,
  ): Promise<void> => {
    assertJsonEntry(entry);
    assertToolPairing(entry);

    const entries = conversations.get(id);
    if (entries === undefined) {
      throw new ConversationNotFoundError(id);
    }

    if (entries.length !== expectedLength) {
      throw new ConversationConflictError(
        id,
        expectedLength,
        entries.length,
      );
    }

    entries.push({ messages: structuredClone(entry.messages) });
  };

  return { create, read, append };
};
