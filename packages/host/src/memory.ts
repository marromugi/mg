import { ReplyLogClosedError } from "./errors.js";
import type {
  NewReply,
  ReplyFilter,
  ReplyLog,
  ReplyRecord,
} from "./types.js";
import { createWatching } from "./watch.js";

const matches = (record: ReplyRecord, filter?: ReplyFilter) =>
  (filter?.conversations === undefined &&
    filter?.prefix === undefined) ||
  filter.conversations?.includes(record.conversationId) === true ||
  (filter.prefix !== undefined &&
    record.conversationId.startsWith(filter.prefix));

export const createMemoryReplyLog = (): ReplyLog => {
  const records: ReplyRecord[] = [];
  const begun = new Map<string, number>();
  let closed = false;

  const read = async (
    after: number,
    limit: number,
    filter?: ReplyFilter,
  ): Promise<ReplyRecord[]> =>
    records
      .filter(
        (record) => record.cursor > after && matches(record, filter),
      )
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
    scheduledFor: async (inputId, callIndex) => {
      if (closed) {
        throw new ReplyLogClosedError();
      }
      const found = records.find(
        (record) =>
          record.kind === "scheduled" &&
          record.inputId === inputId &&
          record.callIndex === callIndex,
      );
      return found?.kind === "scheduled"
        ? structuredClone(found)
        : undefined;
    },
    hasReplyFor: async (inputId) => {
      if (closed) {
        throw new ReplyLogClosedError();
      }
      return records.some(
        (record) =>
          record.inputId === inputId && record.kind !== "scheduled",
      );
    },
    read: async (after, limit, filter) => {
      if (closed) {
        throw new ReplyLogClosedError();
      }
      return read(after, limit, filter);
    },
    watch: (after, signal, filter) =>
      watching.watch(after, signal, filter),
    async close() {
      closed = true;
      watching.notify();
    },
  };
};
