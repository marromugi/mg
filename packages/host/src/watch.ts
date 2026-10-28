import type { ReplyFilter, ReplyRecord } from "./types.js";

const PAGE = 100;

/**
 * Builds `watch` for a log: reads what is already there, then waits for
 * `notify` and reads again. A log calls `notify` after every write and
 * on close.
 */
export const createWatching = (
  read: (
    after: number,
    limit: number,
    filter?: ReplyFilter,
  ) => Promise<ReplyRecord[]>,
  isClosed: () => boolean,
) => {
  const wakers = new Set<() => void>();
  return {
    notify(): void {
      for (const wake of wakers) {
        wake();
      }
    },
    async *watch(
      after: number,
      signal: AbortSignal,
      filter?: ReplyFilter,
    ): AsyncGenerator<ReplyRecord> {
      let cursor = after;
      while (!signal.aborted) {
        let wake!: () => void;
        const waiting = new Promise<void>((resolve) => {
          wake = resolve;
        });
        // Register before reading so a write in between is not missed.
        wakers.add(wake);
        signal.addEventListener("abort", wake, { once: true });
        try {
          const records = await read(cursor, PAGE, filter);
          if (records.length === 0) {
            if (isClosed()) {
              return;
            }
            await waiting;
            continue;
          }
          for (const record of records) {
            yield record;
            cursor = record.cursor;
          }
        } finally {
          wakers.delete(wake);
          signal.removeEventListener("abort", wake);
        }
      }
    },
  };
};
