import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { LibsqlError, createClient } from "@libsql/client";
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import {
  assertJsonEntry,
  assertNewToolCallIds,
  assertToolPairing,
} from "../checks.js";
import {
  ConversationConflictError,
  ConversationEntryUnreadableError,
  ConversationExistsError,
  ConversationNotFoundError,
  ConversationRangeError,
  ConversationStoreClosedError,
} from "../errors.js";
import { collectToolCalls } from "../tool-calls.js";
import type {
  ConversationEntry,
  ConversationSlice,
  ConversationStore,
  ReadRange,
} from "../types.js";
import { conversations, entries } from "./schema.js";

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0;

const isPrimaryKeyViolation = (error: unknown): boolean =>
  error instanceof Error &&
  error.cause instanceof LibsqlError &&
  error.cause.extendedCode === "SQLITE_CONSTRAINT_PRIMARYKEY";

const toEntry = (
  conversationId: string,
  row: { position: number; messages: string },
): ConversationEntry => {
  try {
    return {
      messages: JSON.parse(
        row.messages,
      ) as ConversationEntry["messages"],
    };
  } catch (error) {
    throw new ConversationEntryUnreadableError(
      conversationId,
      row.position,
      error,
    );
  }
};

// libsql は、クエリごとに作った文レコードが回収されるまで、閉じた
// 接続のファイルを手放しません。回収を待たずにファイルを手放すため、
// 閉じた直後に回収を走らせます。
const collectGarbage = ((): (() => void) => {
  setFlagsFromString("--expose-gc");
  return runInNewContext("gc") as () => void;
})();

export interface SqliteConversationStore extends ConversationStore {
  close(): Promise<void>;
}

export const openSqliteConversationStore = async (
  path: string,
): Promise<SqliteConversationStore> => {
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
    throw error;
  }

  let closing: Promise<void> | undefined;
  const inFlight = new Set<Promise<unknown>>();

  const guarded =
    <A extends unknown[], T>(operation: (...args: A) => Promise<T>) =>
    (...args: A): Promise<T> => {
      if (closing !== undefined) {
        return Promise.reject(new ConversationStoreClosedError());
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
      await Promise.allSettled([...inFlight]);
      client.close();
      collectGarbage();
    })();
    return closing;
  };

  const countEntries = async (id: string): Promise<number> => {
    const [row] = await db
      .select({ n: count() })
      .from(entries)
      .where(eq(entries.conversationId, id));
    return row?.n ?? 0;
  };

  // 総数の照合と挿入を、await をまたがずに 1 文で実行します。
  // 別の接続がロックを await の間じゅう持ち続けないようにするためです。
  const insertEntry = async (
    id: string,
    position: number,
    messages: string,
  ): Promise<number> => {
    try {
      const result = await db.run(sql`
        insert into entries (conversation_id, position, messages)
        select ${id}, ${position}, ${messages}
        where exists (select 1 from conversations where id = ${id})
          and (select count(*) from entries where conversation_id = ${id}) = ${position}
      `);
      return result.rowsAffected;
    } catch (error) {
      if (isPrimaryKeyViolation(error)) {
        throw new ConversationConflictError(
          id,
          position,
          await countEntries(id),
        );
      }
      throw error;
    }
  };

  const readAllEntries = async (
    id: string,
  ): Promise<ConversationEntry[]> => {
    const rows = await db
      .select({
        position: entries.position,
        messages: entries.messages,
      })
      .from(entries)
      .where(eq(entries.conversationId, id))
      .orderBy(entries.position);
    return rows.map((row) => toEntry(id, row));
  };

  const create = async (id: string): Promise<void> => {
    try {
      await db.insert(conversations).values({ id });
    } catch (error) {
      if (isPrimaryKeyViolation(error)) {
        throw new ConversationExistsError(id);
      }
      throw error;
    }
  };

  const read = async (
    id: string,
    range: ReadRange,
  ): Promise<ConversationSlice> => {
    if (range.kind === "last" && !isPositiveInteger(range.count)) {
      throw new ConversationRangeError(range.count);
    }

    const [conversationRow] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    if (conversationRow === undefined) {
      throw new ConversationNotFoundError(id);
    }

    const all = await readAllEntries(id);
    const sliced = range.kind === "all" ? all : all.slice(-range.count);

    return {
      entries: sliced,
      length: all.length,
      toolCalls: collectToolCalls(all),
    };
  };

  const append = async (
    id: string,
    entry: ConversationEntry,
    expectedLength: number,
  ): Promise<void> => {
    assertJsonEntry(entry);
    assertToolPairing(entry);

    const [conversationRow] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    if (conversationRow === undefined) {
      throw new ConversationNotFoundError(id);
    }

    const stored = await readAllEntries(id);
    if (stored.length !== expectedLength) {
      throw new ConversationConflictError(
        id,
        expectedLength,
        stored.length,
      );
    }
    assertNewToolCallIds(collectToolCalls(stored), entry);

    const rowsAffected = await insertEntry(
      id,
      expectedLength,
      JSON.stringify(entry.messages),
    );
    if (rowsAffected > 0) {
      return;
    }

    throw new ConversationConflictError(
      id,
      expectedLength,
      await countEntries(id),
    );
  };

  return {
    create: guarded(create),
    read: guarded(read),
    append: guarded(append),
    close,
  };
};
