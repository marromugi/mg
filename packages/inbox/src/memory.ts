import { randomUUID } from "node:crypto";
import { assertJsonInput } from "./checks.js";
import type {
  InboxItem,
  InboxOutcome,
  InboxStore,
  NewInboxItem,
} from "./types.js";

export const createMemoryInboxStore = (): InboxStore => {
  const items: InboxItem[] = [];
  const outcomes = new Map<string, InboxOutcome>();

  return {
    async add(item: NewInboxItem, at: number): Promise<InboxItem> {
      assertJsonInput(item.input);
      const stored: InboxItem = {
        ...structuredClone(item),
        id: randomUUID(),
        addedAt: at,
      };
      items.push(stored);
      return structuredClone(stored);
    },
    async pending(): Promise<InboxItem[]> {
      return structuredClone(
        items
          .map((item, seq) => ({ item, seq }))
          .filter(({ item }) => !outcomes.has(item.id))
          .sort(
            (a, b) =>
              a.item.dueAt - b.item.dueAt ||
              a.item.addedAt - b.item.addedAt ||
              a.seq - b.seq,
          )
          .map(({ item }) => item),
      );
    },
    async settle(id: string, outcome: InboxOutcome): Promise<void> {
      outcomes.set(id, structuredClone(outcome));
    },
    async close(): Promise<void> {},
  };
};
