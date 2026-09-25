import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { describe, expect, test } from "vitest";
import { describeMemoryStoreContract } from "../store-contract.test-helper.js";
import {
  MemoryConflictError,
  MemoryItemNotFoundError,
} from "../errors.js";
import { openSqliteMemoryStore } from "./store.js";

const newDbDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "mg-memory-sqlite-"));

const newDbPath = async (): Promise<string> =>
  join(await newDbDir(), "nested", "memory.db");

const itemA = () => ({
  id: "m1",
  counterpart: "alice",
  text: "likes cats",
  createdAt: 100,
});

const thrown = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
};

describeMemoryStoreContract("SQLite の記憶の保存（:memory:）", () =>
  openSqliteMemoryStore(":memory:"),
);

describeMemoryStoreContract(
  "SQLite の記憶の保存（一時のパス）",
  async () => openSqliteMemoryStore(await newDbPath()),
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
    expect((error as NodeJS.ErrnoException).code).toBe("EEXIST");
  });

  test("resolves writes made without awaiting each other, from two stores opened on the same file, as if they had been called one at a time", async () => {
    const path = await newDbPath();
    const s = await openSqliteMemoryStore(path);
    const t = await openSqliteMemoryStore(path);
    await s.create("jev", "I am Jev.");

    const results = await Promise.allSettled([
      s.write("jev", { persona: { text: "s", expectedVersion: 1 } }),
      t.write("jev", { persona: { text: "t", expectedVersion: 1 } }),
      t.write("jev", { persona: { text: "t2", expectedVersion: 2 } }),
      t.read("jev", { counterparts: [] }),
    ]);

    expect(results[0]).toEqual({ status: "fulfilled", value: {} });
    expect(results[1]).toMatchObject({ status: "rejected" });
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(
      MemoryConflictError,
    );
    expect(
      (results[1] as PromiseRejectedResult).reason.mismatches,
    ).toEqual([
      { kind: "persona", expectedVersion: 1, actualVersion: 2 },
    ]);
    expect(results[2]).toEqual({ status: "fulfilled", value: {} });
    expect(results[3]).toMatchObject({
      status: "fulfilled",
      value: { persona: { text: "t2", version: 3 } },
    });
  });

  test("resolves writes made without awaiting each other, from a store opened on a symbolic link to the same file, the same way as two stores on the same path", async () => {
    const dir = await newDbDir();
    const path = join(dir, "memory.db");
    const link = join(dir, "link.db");
    await symlink(path, link);
    const s = await openSqliteMemoryStore(path);
    const t = await openSqliteMemoryStore(link);
    await s.create("jev", "I am Jev.");

    const results = await Promise.allSettled([
      s.write("jev", { persona: { text: "s", expectedVersion: 1 } }),
      t.write("jev", { persona: { text: "t", expectedVersion: 1 } }),
      t.write("jev", { persona: { text: "t2", expectedVersion: 2 } }),
      t.read("jev", { counterparts: [] }),
    ]);

    expect(results[0]).toEqual({ status: "fulfilled", value: {} });
    expect(results[1]).toMatchObject({ status: "rejected" });
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(
      MemoryConflictError,
    );
    expect(
      (results[1] as PromiseRejectedResult).reason.mismatches,
    ).toEqual([
      { kind: "persona", expectedVersion: 1, actualVersion: 2 },
    ]);
    expect(results[2]).toEqual({ status: "fulfilled", value: {} });
    expect(results[3]).toMatchObject({
      status: "fulfilled",
      value: { persona: { text: "t2", version: 3 } },
    });
  });

  test("resolves deletes of the same item made without awaiting each other, from two stores opened on the same file, as if they had been called one at a time", async () => {
    const path = await newDbPath();
    const s = await openSqliteMemoryStore(path);
    const t = await openSqliteMemoryStore(path);
    await s.create("jev", "I am Jev.");
    await s.write("jev", { add: [itemA()] });

    const results = await Promise.allSettled([
      s.delete("jev", ["m1"]),
      t.delete("jev", ["m1"]),
    ]);

    expect(results[0]).toEqual({
      status: "fulfilled",
      value: undefined,
    });
    expect(results[1]).toMatchObject({ status: "rejected" });
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(
      MemoryItemNotFoundError,
    );
    expect(
      (results[1] as PromiseRejectedResult).reason.itemIds,
    ).toEqual(["m1"]);
  });

  test("opens two stores on the same not-yet-existing path at once, both able to read and write the same memory", async () => {
    const path = await newDbPath();

    const [first, second] = await Promise.all([
      openSqliteMemoryStore(path),
      openSqliteMemoryStore(path),
    ]);
    await first.create("jev", "I am Jev.");
    const view = await second.read("jev", { counterparts: [] });

    expect(view.persona).toEqual({ text: "I am Jev.", version: 1 });
  });

  test("rejects a write with the SQLite busy error after waiting at least 4.5 seconds when another connection holds the write lock, and leaves the persona unchanged", async () => {
    const path = await newDbPath();
    const store = await openSqliteMemoryStore(path);
    await store.create("jev", "I am Jev.");

    const url = pathToFileURL(resolve(path)).href;
    const other = createClient({ url });
    const otherTx = await other.transaction("write");

    const startedAt = Date.now();
    const error = await thrown(
      store.write("jev", {
        persona: { text: "x", expectedVersion: 1 },
      }),
    );
    const elapsedMs = Date.now() - startedAt;

    expect((error as { code?: string }).code).toBe("SQLITE_BUSY");
    expect(elapsedMs).toBeGreaterThanOrEqual(4500);

    await otherTx.rollback();
    other.close();
    const view = await store.read("jev", { counterparts: [] });
    expect(view.persona).toEqual({ text: "I am Jev.", version: 1 });
  }, 10000);
});
