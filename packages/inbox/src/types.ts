export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type InboxItem = {
  id: string;
  conversationId: string;
  input: JsonValue;
  /** Milliseconds since the epoch, on the inbox's clock. */
  dueAt: number;
  addedAt: number;
};

export type InboxOutcome =
  { kind: "done" } | { kind: "failed"; reason: string };

export type NewInboxItem = Omit<InboxItem, "id" | "addedAt">;

/** Keeps pending items and how the settled ones ended. */
export interface InboxStore {
  add(item: NewInboxItem, at: number): Promise<InboxItem>;
  /** Items without an outcome, ordered by dueAt, then by when added. */
  pending(): Promise<InboxItem[]>;
  /** Records the outcome; the item is no longer pending. */
  settle(id: string, outcome: InboxOutcome): Promise<void>;
  close(): Promise<void>;
}

/** Runs one input. A rejection marks the item failed. */
export type InboxRun = (item: InboxItem) => Promise<void>;

export type Clock = {
  now(): number;
  /** Calls fn after ms; the returned function cancels it. */
  setTimer(fn: () => void, ms: number): () => void;
};
