type ReplyBase = {
  /** Increases with every record written to the log, starting at 1. */
  cursor: number;
  conversationId: string;
  /** The id of the inbox item this record answers. */
  inputId: string;
};

export type ReplyRecord =
  | (ReplyBase & { kind: "reply"; text: string })
  | (ReplyBase & { kind: "failed"; reason: string })
  | (ReplyBase & {
      /** The agent set a time to get back to the conversation. */
      kind: "scheduled";
      /** Which `later` call of the input's run set this, from 1. */
      callIndex: number;
      /** Milliseconds since the epoch. */
      dueAt: number;
      note: string;
    });

export type NewReply =
  | Omit<Extract<ReplyRecord, { kind: "reply" }>, "cursor">
  | Omit<Extract<ReplyRecord, { kind: "failed" }>, "cursor">
  | Omit<Extract<ReplyRecord, { kind: "scheduled" }>, "cursor">;

/**
 * Narrows a read to some conversations. A record matches if its
 * conversation id equals one of `conversations` or starts with
 * `prefix`. With neither given, every record matches.
 */
export type ReplyFilter = {
  conversations?: readonly string[];
  prefix?: string;
};

/** Keeps replies in the order written, for clients to read from a cursor. */
export interface ReplyLog {
  append(record: NewReply): Promise<ReplyRecord>;
  /**
   * Notes how many entries the conversation held when the input began
   * to run. The first note for an input is kept; later ones return it
   * with `first: false`.
   */
  begin(
    inputId: string,
    entryCount: number,
  ): Promise<{ entryCount: number; first: boolean }>;
  /** The `scheduled` record the input's nth `later` call wrote, if any. */
  scheduledFor(
    inputId: string,
    callIndex: number,
  ): Promise<Extract<ReplyRecord, { kind: "scheduled" }> | undefined>;
  /**
   * Whether a `reply` or `failed` record answering the input has been
   * written. A `scheduled` record does not answer it.
   */
  hasReplyFor(inputId: string): Promise<boolean>;
  /**
   * Up to `limit` records with a cursor above `after`, in order, that
   * match the filter. Cursors stay those of the whole log.
   */
  read(
    after: number,
    limit: number,
    filter?: ReplyFilter,
  ): Promise<ReplyRecord[]>;
  /**
   * Records above `after`, then each new one as it is written. Ends
   * when the signal aborts or the log closes.
   */
  watch(
    after: number,
    signal: AbortSignal,
    filter?: ReplyFilter,
  ): AsyncIterable<ReplyRecord>;
  close(): Promise<void>;
}

/** A client the host admits, told apart from others by its name. */
export type Client = { name: string; token: string };
