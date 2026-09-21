import type { Message, SystemMessage } from "@mg/core";

export type ConversationMessage = Exclude<Message, SystemMessage>;

export type ConversationEntry = {
  messages: [ConversationMessage, ...ConversationMessage[]];
};

export type ReadRange =
  { kind: "all" } | { kind: "last"; count: number };

export type ConversationSlice = {
  entries: ConversationEntry[];
  length: number;
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
