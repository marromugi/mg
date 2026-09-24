import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { describeMemoryStoreContract } from "../store-contract.test-helper.js";
import {
  MemoryConflictError,
  MemoryItemNotFoundError,
} from "../errors.js";
import { openSqliteMemoryStore } from "./store.js";

const newDbPath = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mg-memory-sqlite-"));
  return join(dir, "nested", "memory.db");
};

const thrown = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
};

describeMemoryStoreContract("SQLite の記憶の保存", () =>
  openSqliteMemoryStore(":memory:"),
);

describe("openSqliteMemoryStore", () => {
  test("creates the directory and file for a nested path, and reads back what was created", async () => {
    const path = await newDbPath();

    const store = await openSqliteMemoryStore(path);
    await store.create("jev", "I am Jev.");
    const view = await store.read("jev", { counterparts: [] });

    expect(view.persona).toEqual({ text: "I am Jev.", version: 1 });
    expect(existsSync(path)).toBe(true);
  });

  test("opens an in-memory store without creating a file named :memory: in the working directory", async () => {
    const store = await openSqliteMemoryStore(":memory:");

    await store.create("jev", "I am Jev.");

    expect(existsSync(join(process.cwd(), ":memory:"))).toBe(false);
  });

  test("reads items added through one connection after reopening the same file with another", async () => {
    const path = await newDbPath();
    const first = await openSqliteMemoryStore(path);
    await first.create("jev", "I am Jev.");
    await first.write("jev", {
      add: [
        {
          id: "m1",
          counterpart: "alice",
          text: "likes cats",
          createdAt: 100,
        },
      ],
    });

    const second = await openSqliteMemoryStore(path);
    const view = await second.read("jev", { counterparts: ["alice"] });

    expect(view.items).toEqual([
      {
        id: "m1",
        counterpart: "alice",
        text: "likes cats",
        createdAt: 100,
        misses: 0,
      },
    ]);
  });

  test("lets the first of two stores opened on the same file write, and rejects the second with the version conflict, leaving the first store's write in place", async () => {
    const path = await newDbPath();
    const s = await openSqliteMemoryStore(path);
    const t = await openSqliteMemoryStore(path);
    await s.create("jev", "I am Jev.");

    await s.write("jev", {
      persona: { text: "s", expectedVersion: 1 },
    });
    const error = await thrown(
      t.write("jev", { persona: { text: "t", expectedVersion: 1 } }),
    );

    expect(error).toBeInstanceOf(MemoryConflictError);
    expect((error as MemoryConflictError).mismatches).toEqual([
      { kind: "persona", expectedVersion: 1, actualVersion: 2 },
    ]);
    const view = await s.read("jev", { counterparts: [] });
    expect(view.persona).toEqual({ text: "s", version: 2 });
  });

  test("lets the first of two stores opened on the same file delete an item, and rejects the second's delete of the same item as not found", async () => {
    const path = await newDbPath();
    const s = await openSqliteMemoryStore(path);
    const t = await openSqliteMemoryStore(path);
    await s.create("jev", "I am Jev.");
    await s.write("jev", {
      add: [
        {
          id: "m1",
          counterpart: "alice",
          text: "likes cats",
          createdAt: 100,
        },
      ],
    });

    await s.delete("jev", ["m1"]);
    const error = await thrown(t.delete("jev", ["m1"]));

    expect(error).toBeInstanceOf(MemoryItemNotFoundError);
    expect((error as MemoryItemNotFoundError).itemIds).toEqual(["m1"]);
  });

  test("rejects opening a store whose path treats a regular file as a directory, and returns no store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mg-memory-sqlite-"));
    writeFileSync(join(dir, "f"), "x");

    const error = await thrown(
      openSqliteMemoryStore(join(dir, "f", "memory.db")),
    );

    expect(error).toBeInstanceOf(Error);
  });
});
