import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { createClient } from "@libsql/client";
import { asc, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { ReplyLogClosedError } from "../errors.js";
import type { NewReply, ReplyLog, ReplyRecord } from "../types.js";
import { createWatching } from "../watch.js";
import { replies } from "./schema.js";

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
  return row.kind === "failed"
    ? { ...base, kind: "failed", reason: row.reason ?? "" }
    : { ...base, kind: "reply", text: row.text ?? "" };
};

// libsql は、クエリごとに作った文レコードが回収されるまで、閉じた
// 接続のファイルを手放しません。回収を待たずにファイルを手放すため、
// 閉じた直後に回収を走らせます。
const collectGarbage = ((): (() => void) => {
  setFlagsFromString("--expose-gc");
  return runInNewContext("gc") as () => void;
})();

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
  ): Promise<ReplyRecord[]> => {
    const rows = await db
      .select()
      .from(replies)
      .where(gt(replies.cursor, after))
      .orderBy(asc(replies.cursor))
      .limit(limit);
    return rows.map(toRecord);
  };

  const watching = createWatching(
    (after, limit) =>
      closing === undefined ? read(after, limit) : Promise.resolve([]),
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
    read: guarded(read),
    watch: (after, signal) => watching.watch(after, signal),
    close,
  };
};
