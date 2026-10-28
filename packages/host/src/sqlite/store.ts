import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { createClient } from "@libsql/client";
import { and, asc, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { ReplyLogClosedError } from "../errors.js";
import type {
  NewReply,
  ReplyFilter,
  ReplyLog,
  ReplyRecord,
} from "../types.js";
import { createWatching } from "../watch.js";
import { begun, replies } from "./schema.js";

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

type Row = typeof replies.$inferSelect;

const toRecord = (row: Row): ReplyRecord => {
  const base = {
    cursor: row.cursor,
    conversationId: row.conversationId,
    inputId: row.inputId,
  };
  switch (row.kind) {
    case "failed":
      return { ...base, kind: "failed", reason: row.reason ?? "" };
    case "scheduled":
      return {
        ...base,
        kind: "scheduled",
        callIndex: row.callIndex ?? 0,
        dueAt: row.dueAt ?? 0,
        note: row.note ?? "",
      };
    default:
      return { ...base, kind: "reply", text: row.text ?? "" };
  }
};

// libsql は、クエリごとに作った文レコードが回収されるまで、閉じた
// 接続のファイルを手放しません。回収を待たずにファイルを手放すため、
// 閉じた直後に回収を走らせます。
const collectGarbage = ((): (() => void) => {
  setFlagsFromString("--expose-gc");
  return runInNewContext("gc") as () => void;
})();

/** The condition for a filter; no condition when it names nothing. */
const matching = (filter?: ReplyFilter) => {
  const conditions = [
    filter?.conversations === undefined
      ? undefined
      : inArray(replies.conversationId, [...filter.conversations]),
    filter?.prefix === undefined
      ? undefined
      : sql`substr(${replies.conversationId}, 1, length(${filter.prefix})) = ${filter.prefix}`,
  ].filter((condition) => condition !== undefined);
  return conditions.length === 0 ? undefined : or(...conditions);
};

export const openSqliteReplyLog = async (
  path: string,
): Promise<ReplyLog> => {
  const url =
    path === ":memory:"
      ? "file::memory:"
      : pathToFileURL(resolve(path)).href;
  if (path !== ":memory:") {
    await fs.mkdir(dirname(path), { recursive: true });
  }
  const client = createClient({ url, timeout: 5000 });
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder });
  } catch (error) {
    client.close();
    collectGarbage();
    throw error;
  }

  let closing: Promise<void> | undefined;
  const inFlight = new Set<Promise<unknown>>();

  const guarded =
    <A extends unknown[], T>(operation: (...args: A) => Promise<T>) =>
    (...args: A): Promise<T> => {
      if (closing !== undefined) {
        return Promise.reject(new ReplyLogClosedError());
      }
      const call = operation(...args);
      const forget = (): void => {
        inFlight.delete(call);
      };
      inFlight.add(call);
      call.then(forget, forget);
      return call;
    };

  const read = async (
    after: number,
    limit: number,
    filter?: ReplyFilter,
  ): Promise<ReplyRecord[]> => {
    const rows = await db
      .select()
      .from(replies)
      .where(and(gt(replies.cursor, after), matching(filter)))
      .orderBy(asc(replies.cursor))
      .limit(limit);
    return rows.map(toRecord);
  };

  const begin = async (
    inputId: string,
    entryCount: number,
  ): Promise<{ entryCount: number; first: boolean }> => {
    const inserted = await db
      .insert(begun)
      .values({ inputId, entryCount })
      .onConflictDoNothing()
      .returning();
    if (inserted.length > 0) {
      return { entryCount, first: true };
    }
    const [row] = await db
      .select()
      .from(begun)
      .where(eq(begun.inputId, inputId));
    return { entryCount: row.entryCount, first: false };
  };

  const scheduledFor = async (
    inputId: string,
    callIndex: number,
  ): Promise<
    Extract<ReplyRecord, { kind: "scheduled" }> | undefined
  > => {
    const [row] = await db
      .select()
      .from(replies)
      .where(
        and(
          eq(replies.inputId, inputId),
          eq(replies.kind, "scheduled"),
          eq(replies.callIndex, callIndex),
        ),
      )
      .limit(1);
    const record = row === undefined ? undefined : toRecord(row);
    return record?.kind === "scheduled" ? record : undefined;
  };

  const hasReplyFor = async (inputId: string): Promise<boolean> => {
    const rows = await db
      .select({ cursor: replies.cursor })
      .from(replies)
      .where(
        and(
          eq(replies.inputId, inputId),
          ne(replies.kind, "scheduled"),
        ),
      )
      .limit(1);
    return rows.length > 0;
  };

  const watching = createWatching(
    (after, limit, filter) =>
      closing === undefined
        ? read(after, limit, filter)
        : Promise.resolve([]),
    () => closing !== undefined,
  );

  const append = async (record: NewReply): Promise<ReplyRecord> => {
    const [row] = await db
      .insert(replies)
      .values({
        conversationId: record.conversationId,
        inputId: record.inputId,
        kind: record.kind,
        text: record.kind === "reply" ? record.text : null,
        reason: record.kind === "failed" ? record.reason : null,
        dueAt: record.kind === "scheduled" ? record.dueAt : null,
        callIndex:
          record.kind === "scheduled" ? record.callIndex : null,
        note: record.kind === "scheduled" ? record.note : null,
      })
      .returning();
    watching.notify();
    return toRecord(row);
  };

  const close = (): Promise<void> => {
    closing ??= (async () => {
      watching.notify();
      await Promise.allSettled(inFlight);
      client.close();
      collectGarbage();
    })();
    return closing;
  };

  return {
    append: guarded(append),
    begin: guarded(begin),
    hasReplyFor: guarded(hasReplyFor),
    scheduledFor: guarded(scheduledFor),
    read: guarded(read),
    watch: (after, signal, filter) =>
      watching.watch(after, signal, filter),
    close,
  };
};
