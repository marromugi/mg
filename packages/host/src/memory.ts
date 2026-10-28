import { ReplyLogClosedError } from "./errors.js";
import type { NewReply, ReplyLog, ReplyRecord } from "./types.js";
import { createWatching } from "./watch.js";

export const createMemoryReplyLog = (): ReplyLog => {
  const records: ReplyRecord[] = [];
  const begun = new Map<string, number>();
  let closed = false;

  const read = async (
    after: number,
    limit: number,
  ): Promise<ReplyRecord[]> =>
    records
      .filter((record) => record.cursor > after)
      .slice(0, limit)
      .map((record) => structuredClone(record));

  const watching = createWatching(read, () => closed);

  return {
    async append(record: NewReply) {
      if (closed) {
        throw new ReplyLogClosedError();
      }
      const stored = {
        ...structuredClone(record),
        cursor: records.length + 1,
      };
      records.push(stored);
      watching.notify();
      return structuredClone(stored);
    },
    begin: async (inputId, entryCount) => {
      if (closed) {
        throw new ReplyLogClosedError();
      }
      const noted = begun.get(inputId);
      if (noted !== undefined) {
        return { entryCount: noted, first: false };
      }
      begun.set(inputId, entryCount);
      return { entryCount, first: true };
    },
    hasReplyFor: async (inputId) => {
      if (closed) {
        throw new ReplyLogClosedError();
      }
      return records.some((record) => record.inputId === inputId);
    },
    read: async (after, limit) => {
      if (closed) {
        throw new ReplyLogClosedError();
      }
      return read(after, limit);
    },
    watch: (after, signal) => watching.watch(after, signal),
    async close() {
      closed = true;
      watching.notify();
    },
  };
};
