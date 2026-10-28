import { HostRequestError } from "./errors.js";
import { readNdjson } from "./ndjson.js";
import type {
  HostClient,
  HostClientOptions,
  RepliesOptions,
  ReplyRecord,
} from "./types.js";

const FIRST_DELAY_MS = 500;
const LAST_DELAY_MS = 30_000;

const errorText = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => "");
  try {
    const { error } = JSON.parse(text) as { error?: unknown };
    if (typeof error === "string") {
      return error;
    }
  } catch {
    // Not JSON; the body itself is the text.
  }
  return text;
};

const pause = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });

export const createHostClient = (
  options: HostClientOptions,
): HostClient => {
  const base = options.url.replace(/\/+$/, "");
  const call = options.fetch ?? globalThis.fetch;
  const headers = { authorization: `Bearer ${options.token}` };

  async function* replies(
    request: RepliesOptions,
  ): AsyncGenerator<ReplyRecord> {
    const { signal } = request;
    if (
      request.conversations?.length === 0 &&
      request.prefix === undefined
    ) {
      return;
    }
    let after = request.after;
    let delay = FIRST_DELAY_MS;
    const aborted = (): boolean => signal?.aborted === true;
    while (!aborted()) {
      const connection = new AbortController();
      const stop = (): void => connection.abort();
      signal?.addEventListener("abort", stop, { once: true });
      try {
        const query = new URLSearchParams({ after: String(after) });
        for (const id of request.conversations ?? []) {
          query.append("conversation", id);
        }
        if (request.prefix !== undefined) {
          query.set("prefix", request.prefix);
        }
        const response = await call(`${base}/replies?${query}`, {
          headers,
          signal: connection.signal,
        });
        if (response.status === 400 || response.status === 401) {
          throw new HostRequestError(
            response.status,
            await errorText(response),
          );
        }
        if (!response.ok || response.body === null) {
          throw new Error(`The host answered ${response.status}.`);
        }
        for await (const value of readNdjson(response.body)) {
          const record = value as ReplyRecord;
          delay = FIRST_DELAY_MS;
          yield record;
          after = record.cursor;
        }
      } catch (error) {
        if (aborted()) {
          return;
        }
        if (error instanceof HostRequestError) {
          throw error;
        }
      } finally {
        signal?.removeEventListener("abort", stop);
        connection.abort();
      }
      await pause(delay, signal);
      delay = Math.min(delay * 2, LAST_DELAY_MS);
    }
  }

  return {
    async send(conversationId, text, sendOptions) {
      const response = await call(
        `${base}/conversations/${encodeURIComponent(conversationId)}/inputs`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ text, dueAt: sendOptions?.dueAt }),
        },
      );
      if (!response.ok) {
        throw new HostRequestError(
          response.status,
          await errorText(response),
        );
      }
      return (await response.json()) as { id: string; dueAt: number };
    },
    replies,
  };
};
