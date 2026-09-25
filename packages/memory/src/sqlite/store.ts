import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LibsqlError, createClient } from "@libsql/client";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import {
  MemoryArgumentError,
  MemoryConflictError,
  MemoryItemExistsError,
  MemoryItemNotFoundError,
  PersonaExistsError,
  PersonaNotFoundError,
  type MemoryConflictMismatch,
} from "../errors.js";
import type {
  MemoryChange,
  MemoryItem,
  MemorySelection,
  MemoryStore,
  MemoryView,
  MissCounts,
  NewMemoryItem,
} from "../types.js";
import { runQueued } from "./queue.js";
import { items, personas, summaries } from "./schema.js";

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

const isEmpty = (value: string): boolean => value.trim().length === 0;

const isNonNegativeInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 0;

const findDuplicate = (ids: readonly string[]): string | undefined => {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      return id;
    }
    seen.add(id);
  }
  return undefined;
};

const isEmptyChange = (change: MemoryChange): boolean =>
  change.persona === undefined &&
  change.summary === undefined &&
  (change.add === undefined || change.add.length === 0) &&
  (change.hits === undefined || change.hits.length === 0) &&
  (change.misses === undefined || change.misses.length === 0);

const validateSelection = (selection: MemorySelection): void => {
  const duplicate = findDuplicate(selection.counterparts);
  if (duplicate !== undefined) {
    throw new MemoryArgumentError(
      "duplicate-id",
      `Counterpart id "${duplicate}" appears more than once.`,
    );
  }
  for (const counterpart of selection.counterparts) {
    if (isEmpty(counterpart)) {
      throw new MemoryArgumentError(
        "empty-id",
        "A counterpart id must not be empty.",
      );
    }
  }
  if (
    selection.conversation !== undefined &&
    isEmpty(selection.conversation)
  ) {
    throw new MemoryArgumentError(
      "empty-id",
      "The conversation id must not be empty.",
    );
  }
};

const validateNewItem = (item: NewMemoryItem): void => {
  if (isEmpty(item.id)) {
    throw new MemoryArgumentError(
      "empty-id",
      "An item id must not be empty.",
    );
  }
  if (isEmpty(item.counterpart)) {
    throw new MemoryArgumentError(
      "empty-id",
      "An item's counterpart id must not be empty.",
    );
  }
  if (isEmpty(item.text)) {
    throw new MemoryArgumentError(
      "empty-text",
      "An item's text must not be empty.",
    );
  }
  if (!Number.isFinite(item.createdAt)) {
    throw new MemoryArgumentError(
      "invalid-time",
      "An item's createdAt must be a finite number.",
    );
  }
};

const validateChange = (change: MemoryChange): void => {
  if (isEmptyChange(change)) {
    throw new MemoryArgumentError(
      "empty-change",
      "The change must set at least one field.",
    );
  }

  if (change.persona !== undefined) {
    if (isEmpty(change.persona.text)) {
      throw new MemoryArgumentError(
        "empty-text",
        "The persona's text must not be empty.",
      );
    }
    if (!isNonNegativeInteger(change.persona.expectedVersion)) {
      throw new MemoryArgumentError(
        "invalid-version",
        "The persona's expectedVersion must be a non-negative integer.",
      );
    }
  }

  if (change.summary !== undefined) {
    if (isEmpty(change.summary.conversation)) {
      throw new MemoryArgumentError(
        "empty-id",
        "The summary's conversation id must not be empty.",
      );
    }
    if (isEmpty(change.summary.text)) {
      throw new MemoryArgumentError(
        "empty-text",
        "The summary's text must not be empty.",
      );
    }
    if (!isNonNegativeInteger(change.summary.expectedVersion)) {
      throw new MemoryArgumentError(
        "invalid-version",
        "The summary's expectedVersion must be a non-negative integer.",
      );
    }
  }

  if (change.add !== undefined) {
    for (const item of change.add) {
      validateNewItem(item);
    }
    const duplicate = findDuplicate(change.add.map((item) => item.id));
    if (duplicate !== undefined) {
      throw new MemoryArgumentError(
        "duplicate-id",
        `Item id "${duplicate}" appears more than once in add.`,
      );
    }
  }

  if (change.hits !== undefined) {
    for (const id of change.hits) {
      if (isEmpty(id)) {
        throw new MemoryArgumentError(
          "empty-id",
          "An item id must not be empty.",
        );
      }
    }
    const duplicate = findDuplicate(change.hits);
    if (duplicate !== undefined) {
      throw new MemoryArgumentError(
        "duplicate-id",
        `Item id "${duplicate}" appears more than once in hits.`,
      );
    }
  }

  if (change.misses !== undefined) {
    for (const id of change.misses) {
      if (isEmpty(id)) {
        throw new MemoryArgumentError(
          "empty-id",
          "An item id must not be empty.",
        );
      }
    }
    const duplicate = findDuplicate(change.misses);
    if (duplicate !== undefined) {
      throw new MemoryArgumentError(
        "duplicate-id",
        `Item id "${duplicate}" appears more than once in misses.`,
      );
    }
  }

  if (change.hits !== undefined && change.misses !== undefined) {
    const misses = new Set(change.misses);
    const overlap = change.hits.find((id) => misses.has(id));
    if (overlap !== undefined) {
      throw new MemoryArgumentError(
        "hit-and-miss",
        `Item id "${overlap}" is both hit and missed.`,
      );
    }
  }
};

const validateDeleteIds = (itemIds: readonly string[]): void => {
  if (itemIds.length === 0) {
    throw new MemoryArgumentError(
      "empty-list",
      "The list of item ids to delete must not be empty.",
    );
  }
  for (const id of itemIds) {
    if (isEmpty(id)) {
      throw new MemoryArgumentError(
        "empty-id",
        "An item id must not be empty.",
      );
    }
  }
  const duplicate = findDuplicate(itemIds);
  if (duplicate !== undefined) {
    throw new MemoryArgumentError(
      "duplicate-id",
      `Item id "${duplicate}" appears more than once.`,
    );
  }
};

const toMemoryItem = (row: {
  id: string;
  counterpart: string;
  text: string;
  createdAt: number;
  misses: number;
}): MemoryItem => ({
  id: row.id,
  counterpart: row.counterpart,
  text: row.text,
  createdAt: row.createdAt,
  misses: row.misses,
});

const isPrimaryKeyViolation = (error: unknown): boolean =>
  error instanceof Error &&
  error.cause instanceof LibsqlError &&
  error.cause.extendedCode === "SQLITE_CONSTRAINT_PRIMARYKEY";

// drizzle は、クエリの失敗を自分の Error で包み、元の libsql のエラーを
// cause に持たせます。busy のような、対応の決まっていないエラーは、
// 包みを外して libsql のエラーのまま呼び出し元に届けます。
const unwrapLibsqlError = (error: unknown): unknown =>
  error instanceof Error && error.cause instanceof LibsqlError
    ? error.cause
    : error;

// 同じファイルを指す別名（シンボリックリンクなど）も同じ鍵になるよう、
// パスではなくデバイスと inode で見分けます。
const fileQueueKey = async (path: string): Promise<string> => {
  await fs.mkdir(dirname(path), { recursive: true });
  const handle = await fs.open(path, "a");
  await handle.close();
  const stat = await fs.stat(path);
  return `${stat.dev}:${stat.ino}`;
};

export const openSqliteMemoryStore = async (
  path: string,
): Promise<MemoryStore> => {
  const queueKey =
    path === ":memory:"
      ? `memory:${randomUUID()}`
      : await fileQueueKey(path);
  const run = <T>(operation: () => Promise<T>): Promise<T> =>
    runQueued(queueKey, async () => {
      try {
        return await operation();
      } catch (error) {
        throw unwrapLibsqlError(error);
      }
    });

  const url =
    path === ":memory:"
      ? "file::memory:"
      : pathToFileURL(resolve(path)).href;
  const client = createClient({ url, timeout: 5000 });
  const db = drizzle(client);
  try {
    await run(() => migrate(db, { migrationsFolder }));
  } catch (error) {
    client.close();
    throw error;
  }

  const getPersona = async (
    personaId: string,
  ): Promise<
    { personaText: string; personaVersion: number } | undefined
  > => {
    const [row] = await db
      .select()
      .from(personas)
      .where(eq(personas.id, personaId));
    return row;
  };

  const requirePersona = async (
    personaId: string,
  ): Promise<{ personaText: string; personaVersion: number }> => {
    const row = await getPersona(personaId);
    if (row === undefined) {
      throw new PersonaNotFoundError(personaId);
    }
    return row;
  };

  const create = async (
    personaId: string,
    personaText: string,
  ): Promise<void> =>
    run(async () => {
      if (isEmpty(personaId)) {
        throw new MemoryArgumentError(
          "empty-id",
          "The persona id must not be empty.",
        );
      }
      if (isEmpty(personaText)) {
        throw new MemoryArgumentError(
          "empty-text",
          "The persona's text must not be empty.",
        );
      }
      try {
        await db
          .insert(personas)
          .values({ id: personaId, personaText, personaVersion: 1 });
      } catch (error) {
        if (isPrimaryKeyViolation(error)) {
          throw new PersonaExistsError(personaId);
        }
        throw error;
      }
    });

  const readInStore = async (
    personaId: string,
    selection: MemorySelection,
  ): Promise<MemoryView> => {
    const persona = await requirePersona(personaId);
    validateSelection(selection);

    const itemRows =
      selection.counterparts.length === 0
        ? []
        : await db
            .select()
            .from(items)
            .where(
              and(
                eq(items.personaId, personaId),
                inArray(items.counterpart, selection.counterparts),
              ),
            )
            .orderBy(desc(items.createdAt), desc(items.seq));

    const summaryRow =
      selection.conversation === undefined
        ? undefined
        : (
            await db
              .select()
              .from(summaries)
              .where(
                and(
                  eq(summaries.personaId, personaId),
                  eq(summaries.conversationId, selection.conversation),
                ),
              )
          )[0];

    return {
      persona: {
        text: persona.personaText,
        version: persona.personaVersion,
      },
      items: itemRows.map(toMemoryItem),
      ...(summaryRow === undefined
        ? {}
        : {
            summary: {
              text: summaryRow.text,
              version: summaryRow.version,
            },
          }),
    };
  };

  const read = (
    personaId: string,
    selection: MemorySelection,
  ): Promise<MemoryView> =>
    run(() => readInStore(personaId, selection));

  const writeInStore = async (
    personaId: string,
    change: MemoryChange,
  ): Promise<MissCounts> => {
    await requirePersona(personaId);
    validateChange(change);

    return db.transaction(async (tx) => {
      const [personaRow] = await tx
        .select()
        .from(personas)
        .where(eq(personas.id, personaId));
      if (personaRow === undefined) {
        throw new PersonaNotFoundError(personaId);
      }

      const mismatches: MemoryConflictMismatch[] = [];
      if (
        change.persona !== undefined &&
        change.persona.expectedVersion !== personaRow.personaVersion
      ) {
        mismatches.push({
          kind: "persona",
          expectedVersion: change.persona.expectedVersion,
          actualVersion: personaRow.personaVersion,
        });
      }

      let summaryRow: { version: number } | undefined;
      if (change.summary !== undefined) {
        [summaryRow] = await tx
          .select()
          .from(summaries)
          .where(
            and(
              eq(summaries.personaId, personaId),
              eq(summaries.conversationId, change.summary.conversation),
            ),
          );
        const actualVersion = summaryRow?.version ?? 0;
        if (change.summary.expectedVersion !== actualVersion) {
          mismatches.push({
            kind: "summary",
            key: change.summary.conversation,
            expectedVersion: change.summary.expectedVersion,
            actualVersion,
          });
        }
      }

      if (mismatches.length > 0) {
        throw new MemoryConflictError(personaId, mismatches);
      }

      if (change.add !== undefined && change.add.length > 0) {
        const addIds = change.add.map((item) => item.id);
        const existingRows = await tx
          .select({ id: items.id })
          .from(items)
          .where(
            and(
              eq(items.personaId, personaId),
              inArray(items.id, addIds),
            ),
          );
        const existing = new Set(existingRows.map((row) => row.id));
        const existingIds = addIds.filter((id) => existing.has(id));
        if (existingIds.length > 0) {
          throw new MemoryItemExistsError(personaId, existingIds);
        }
      }

      const hitAndMissIds = [
        ...(change.hits ?? []),
        ...(change.misses ?? []),
      ];
      if (hitAndMissIds.length > 0) {
        const foundRows = await tx
          .select({ id: items.id })
          .from(items)
          .where(
            and(
              eq(items.personaId, personaId),
              inArray(items.id, hitAndMissIds),
            ),
          );
        const found = new Set(foundRows.map((row) => row.id));
        const missingIds = hitAndMissIds.filter((id) => !found.has(id));
        if (missingIds.length > 0) {
          throw new MemoryItemNotFoundError(personaId, missingIds);
        }
      }

      if (change.persona !== undefined) {
        await tx
          .update(personas)
          .set({
            personaText: change.persona.text,
            personaVersion: personaRow.personaVersion + 1,
          })
          .where(eq(personas.id, personaId));
      }

      if (change.summary !== undefined) {
        const actualVersion = summaryRow?.version ?? 0;
        if (summaryRow === undefined) {
          await tx.insert(summaries).values({
            personaId,
            conversationId: change.summary.conversation,
            text: change.summary.text,
            version: 1,
          });
        } else {
          await tx
            .update(summaries)
            .set({
              text: change.summary.text,
              version: actualVersion + 1,
            })
            .where(
              and(
                eq(summaries.personaId, personaId),
                eq(
                  summaries.conversationId,
                  change.summary.conversation,
                ),
              ),
            );
        }
      }

      if (change.add !== undefined && change.add.length > 0) {
        const maxSeq = sql<number | null>`max(${items.seq})`.as(
          "maxSeq",
        );
        const [maxSeqRow] = await tx
          .select({ maxSeq })
          .from(items)
          .where(eq(items.personaId, personaId));
        let nextSeq = (maxSeqRow?.maxSeq ?? -1) + 1;
        for (const item of change.add) {
          await tx.insert(items).values({
            personaId,
            id: item.id,
            counterpart: item.counterpart,
            text: item.text,
            createdAt: item.createdAt,
            misses: 0,
            seq: nextSeq,
          });
          nextSeq += 1;
        }
      }

      if (change.hits !== undefined && change.hits.length > 0) {
        await tx
          .update(items)
          .set({ misses: 0 })
          .where(
            and(
              eq(items.personaId, personaId),
              inArray(items.id, change.hits),
            ),
          );
      }

      const missCounts: [string, number][] = [];
      for (const id of change.misses ?? []) {
        const [row] = await tx
          .update(items)
          .set({ misses: sql`${items.misses} + 1` })
          .where(and(eq(items.personaId, personaId), eq(items.id, id)))
          .returning({ misses: items.misses });
        if (row !== undefined) {
          missCounts.push([id, row.misses]);
        }
      }

      return Object.fromEntries(missCounts);
    });
  };

  const write = (
    personaId: string,
    change: MemoryChange,
  ): Promise<MissCounts> => run(() => writeInStore(personaId, change));

  const deleteInStore = async (
    personaId: string,
    itemIds: readonly string[],
  ): Promise<void> => {
    await requirePersona(personaId);
    validateDeleteIds(itemIds);

    await db.transaction(async (tx) => {
      const foundRows = await tx
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.personaId, personaId),
            inArray(items.id, itemIds),
          ),
        );
      const found = new Set(foundRows.map((row) => row.id));
      const missingIds = itemIds.filter((id) => !found.has(id));
      if (missingIds.length > 0) {
        throw new MemoryItemNotFoundError(personaId, missingIds);
      }

      await tx
        .delete(items)
        .where(
          and(
            eq(items.personaId, personaId),
            inArray(items.id, itemIds),
          ),
        );
    });
  };

  const deleteItems = (
    personaId: string,
    itemIds: readonly string[],
  ): Promise<void> => run(() => deleteInStore(personaId, itemIds));

  return { create, read, write, delete: deleteItems };
};
