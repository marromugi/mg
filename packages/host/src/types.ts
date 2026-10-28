type ReplyBase = {
  /** Increases with every record written to the log, starting at 1. */
  cursor: number;
  conversationId: string;
  /** The id of the inbox item this record answers. */
  inputId: string;
};

export type ReplyRecord =
  | (ReplyBase & { kind: "reply"; text: string })
  | (ReplyBase & { kind: "failed"; reason: string });

export type NewReply =
  | Omit<Extract<ReplyRecord, { kind: "reply" }>, "cursor">
  | Omit<Extract<ReplyRecord, { kind: "failed" }>, "cursor">;

/** Keeps replies in the order written, for clients to read from a cursor. */
export interface ReplyLog {
  append(record: NewReply): Promise<ReplyRecord>;
  /** Up to `limit` records with a cursor above `after`, in order. */
  read(after: number, limit: number): Promise<ReplyRecord[]>;
  /**
   * Records above `after`, then each new one as it is written. Ends
   * when the signal aborts or the log closes.
   */
  watch(after: number, signal: AbortSignal): AsyncIterable<ReplyRecord>;
  close(): Promise<void>;
}

/** A client the host admits, told apart from others by its name. */
export type Client = { name: string; token: string };
