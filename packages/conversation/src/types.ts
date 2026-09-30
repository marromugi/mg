import type { Message } from "@mg/core";

export type ConversationEntry = {
  messages: [Message, ...Message[]];
};

export type ReadRange =
  { kind: "all" } | { kind: "last"; count: number };

export type StoredToolCall = { id: string; position: number };

export type ConversationSlice = {
  entries: ConversationEntry[];
  length: number;
  toolCalls: StoredToolCall[];
};

export interface ConversationStore {
  create(id: string): Promise<void>;
  read(id: string, range: ReadRange): Promise<ConversationSlice>;
  append(
    id: string,
    entry: ConversationEntry,
    expectedLength: number,
  ): Promise<void>;
}
