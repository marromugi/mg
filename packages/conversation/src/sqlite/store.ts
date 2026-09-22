import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LibsqlError, createClient } from "@libsql/client";
import { count, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { assertJsonEntry, assertToolPairing } from "../checks.js";
import {
  ConversationConflictError,
  ConversationExistsError,
  ConversationNotFoundError,
  ConversationRangeError,
} from "../errors.js";
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

const toEntry = (row: { messages: string }): ConversationEntry => ({
  messages: JSON.parse(row.messages) as ConversationEntry["messages"],
});

export const openSqliteConversationStore = async (
  path: string,
): Promise<ConversationStore> => {
  const url =
    path === ":memory:"
      ? "file::memory:"
      : pathToFileURL(resolve(path)).href;
  if (path !== ":memory:") {
    await fs.mkdir(dirname(path), { recursive: true });
  }
  const client = createClient({ url, timeout: 5000 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder });

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

    const total =
      sql<number>`(select count(*) from entries where conversation_id = ${id})`.as(
        "total",
      );

    const rows =
      range.kind === "all"
        ? await db
            .select({ messages: entries.messages, total })
            .from(entries)
            .where(eq(entries.conversationId, id))
            .orderBy(entries.position)
        : (
            await db
              .select({ messages: entries.messages, total })
              .from(entries)
              .where(eq(entries.conversationId, id))
              .orderBy(desc(entries.position))
              .limit(range.count)
          ).reverse();

    return {
      entries: rows.map(toEntry),
      length: rows[0]?.total ?? 0,
    };
  };

  const append = async (
    id: string,
    entry: ConversationEntry,
    expectedLength: number,
  ): Promise<void> => {
    assertJsonEntry(entry);
    assertToolPairing(entry);

    const rowsAffected = await insertEntry(
      id,
      expectedLength,
      JSON.stringify(entry.messages),
    );
    if (rowsAffected > 0) {
      return;
    }

    const [conversationRow] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    if (conversationRow === undefined) {
      throw new ConversationNotFoundError(id);
    }
    throw new ConversationConflictError(
      id,
      expectedLength,
      await countEntries(id),
    );
  };

  return { create, read, append };
};
