import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LibsqlError, createClient } from "@libsql/client";
import { and, count, eq, gte } from "drizzle-orm";
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

    const [lengthRow] = await db
      .select({ n: count() })
      .from(entries)
      .where(eq(entries.conversationId, id));
    const length = lengthRow?.n ?? 0;

    const rows =
      range.kind === "all"
        ? await db
            .select()
            .from(entries)
            .where(eq(entries.conversationId, id))
            .orderBy(entries.position)
        : await db
            .select()
            .from(entries)
            .where(
              and(
                eq(entries.conversationId, id),
                gte(entries.position, length - range.count),
              ),
            )
            .orderBy(entries.position);

    return {
      entries: rows.map((row): ConversationEntry => ({
        messages: JSON.parse(
          row.messages,
        ) as ConversationEntry["messages"],
      })),
      length,
    };
  };

  const append = async (
    id: string,
    entry: ConversationEntry,
    expectedLength: number,
  ): Promise<void> => {
    assertJsonEntry(entry);
    assertToolPairing(entry);

    await db.transaction(async (tx) => {
      const [conversationRow] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.id, id));
      if (conversationRow === undefined) {
        throw new ConversationNotFoundError(id);
      }

      const [lengthRow] = await tx
        .select({ n: count() })
        .from(entries)
        .where(eq(entries.conversationId, id));
      const actualLength = lengthRow?.n ?? 0;

      if (actualLength !== expectedLength) {
        throw new ConversationConflictError(
          id,
          expectedLength,
          actualLength,
        );
      }

      try {
        await tx.insert(entries).values({
          conversationId: id,
          position: expectedLength,
          messages: JSON.stringify(entry.messages),
        });
      } catch (error) {
        if (isPrimaryKeyViolation(error)) {
          const [reReadRow] = await tx
            .select({ n: count() })
            .from(entries)
            .where(eq(entries.conversationId, id));
          throw new ConversationConflictError(
            id,
            expectedLength,
            reReadRow?.n ?? 0,
          );
        }
        throw error;
      }
    });
  };

  return { create, read, append };
};
