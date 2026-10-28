import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { createClient } from "@libsql/client";
import { asc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { assertJsonInput } from "../checks.js";
import {
  InboxItemUnreadableError,
  InboxStoreClosedError,
} from "../errors.js";
import type {
  InboxItem,
  InboxOutcome,
  InboxStore,
  JsonValue,
  NewInboxItem,
} from "../types.js";
import { inboxItems } from "./schema.js";

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

const toItem = (row: {
  id: string;
  conversationId: string;
  input: string;
  dueAt: number;
  addedAt: number;
}): InboxItem => {
  try {
    return {
      id: row.id,
      conversationId: row.conversationId,
      input: JSON.parse(row.input) as JsonValue,
      dueAt: row.dueAt,
      addedAt: row.addedAt,
    };
  } catch (error) {
    throw new InboxItemUnreadableError(row.id, error);
  }
};

// libsql は、クエリごとに作った文レコードが回収されるまで、閉じた
// 接続のファイルを手放しません。回収を待たずにファイルを手放すため、
// 閉じた直後に回収を走らせます。
const collectGarbage = ((): (() => void) => {
  setFlagsFromString("--expose-gc");
  return runInNewContext("gc") as () => void;
})();

export const openSqliteInboxStore = async (
  path: string,
): Promise<InboxStore> => {
  const url =
    path === ":memory:"
      ? "file::memory:"
      : pathToFileURL(resolve(path)).href;
  if (path !== ":memory:") {
    await fs.mkdir(dirname(path), { recursive: true });
  }
  const client = createClient({ url, timeout: 5000 });
  const db = drizzle(client);

  const listPending = async (): Promise<InboxItem[]> => {
    const rows = await db
      .select()
      .from(inboxItems)
      .where(isNull(inboxItems.outcome))
      .orderBy(
        asc(inboxItems.dueAt),
        asc(inboxItems.addedAt),
        asc(inboxItems.seq),
      );
    return rows.map(toItem);
  };

  try {
    await migrate(db, { migrationsFolder });
    await listPending();
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
        return Promise.reject(new InboxStoreClosedError());
      }
      const call = operation(...args);
      const forget = (): void => {
        inFlight.delete(call);
      };
      inFlight.add(call);
      call.then(forget, forget);
      return call;
    };

  const close = (): Promise<void> => {
    closing ??= (async () => {
      await Promise.allSettled(inFlight);
      client.close();
      collectGarbage();
    })();
    return closing;
  };

  const add = async (
    item: NewInboxItem,
    at: number,
  ): Promise<InboxItem> => {
    assertJsonInput(item.input);
    const id = randomUUID();
    await db.insert(inboxItems).values({
      id,
      conversationId: item.conversationId,
      input: JSON.stringify(item.input),
      dueAt: item.dueAt,
      addedAt: at,
    });
    return {
      id,
      conversationId: item.conversationId,
      input: structuredClone(item.input),
      dueAt: item.dueAt,
      addedAt: at,
    };
  };

  const settle = async (
    id: string,
    outcome: InboxOutcome,
  ): Promise<void> => {
    await db
      .update(inboxItems)
      .set({
        outcome: outcome.kind,
        reason: outcome.kind === "failed" ? outcome.reason : null,
      })
      .where(eq(inboxItems.id, id));
  };

  return {
    add: guarded(add),
    pending: guarded(listPending),
    settle: guarded(settle),
    close,
  };
};
