type ReplyBase = {
  /** Increases with every record the host writes, starting at 1. */
  cursor: number;
  conversationId: string;
  /** The id of the input this record answers. */
  inputId: string;
};

export type ReplyRecord =
  | (ReplyBase & { kind: "reply"; text: string })
  | (ReplyBase & { kind: "failed"; reason: string })
  | (ReplyBase & {
      kind: "scheduled";
      callIndex: number;
      /** Milliseconds since the epoch. */
      dueAt: number;
      note: string;
    });

export type HostClientOptions = {
  /** The host's address, such as `http://127.0.0.1:8787`. */
  url: string;
  token: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
};

export type SendOptions = {
  /** Milliseconds since the epoch. Defaults to now on the host. */
  dueAt?: number;
};

export type RepliesOptions = {
  /** Records with a cursor above this are yielded. */
  after: number;
  /** Exact conversation ids to read. */
  conversations?: readonly string[];
  /** Also reads every conversation whose id starts with this. */
  prefix?: string;
  /** Ends the iterable, without an error, when aborted. */
  signal?: AbortSignal;
};

export interface HostClient {
  /** Puts input into a conversation. Answers with its id and due time. */
  send(
    conversationId: string,
    text: string,
    options?: SendOptions,
  ): Promise<{ id: string; dueAt: number }>;
  /**
   * Yields replies as the host writes them. When the stream ends or
   * fails, it reconnects from the cursor of the last record whose
   * step in the iteration completed: after 500 ms, then doubling up
   * to 30 s, starting over once a record arrives. `401` and `400`
   * are thrown, not retried. Keep the cursor of each record after
   * handling it, and pass it as `after` to start from there next time.
   */
  replies(options: RepliesOptions): AsyncIterable<ReplyRecord>;
}
