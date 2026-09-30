import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { describe, expect, test } from "vitest";
import { describeMemoryStoreContract } from "../store-contract.test-helper.js";
import {
  MemoryArgumentError,
  MemoryConflictError,
  MemoryItemNotFoundError,
  PersonaNotFoundError,
} from "../errors.js";
import { MemoryStoreClosedError } from "./errors.js";
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

describe("close", () => {
  const tempPath = async (): Promise<string> =>
    join(await newDbDir(), "memory.db");

  const closedMessage =
    "The memory store is closed. Open it again to keep using it.";

  const openDescriptors = (path: string): number => {
    const real = realpathSync(path);
    return execFileSync("lsof", ["-p", String(process.pid), "-Fn"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter((line) => line === `n${real}`).length;
  };

  const track = (
    order: string[],
    label: string,
    promise: Promise<unknown>,
  ) =>
    promise.then(
      (value) => {
        order.push(label);
        return value;
      },
      (error: unknown) => {
        order.push(label);
        throw error;
      },
    );

  test("waits for a pending write, keeps what it wrote, and resolves to undefined", async () => {
    const path = await tempPath();
    const store = await openSqliteMemoryStore(path);
    await store.create("jev", "I am Jev.");
    const order: string[] = [];

    const write = track(
      order,
      "write",
      store.write("jev", { add: [itemA()] }),
    );
    const close = track(order, "close", store.close());

    expect(await write).toEqual({});
    expect(await close).toBeUndefined();
    expect(order).toEqual(["write", "close"]);
    const other = await openSqliteMemoryStore(path);
    expect(
      (await other.read("jev", { counterparts: ["alice"] })).items,
    ).toEqual([{ ...itemA(), misses: 0 }]);
  });

  test("waits for a pending read that rejects", async () => {
    const store = await openSqliteMemoryStore(await tempPath());
    await store.create("jev", "I am Jev.");
    const order: string[] = [];

    const read = track(
      order,
      "read",
      store.read("nobody", { counterparts: [] }),
    );
    const close = track(order, "close", store.close());

    expect(await thrown(read)).toBeInstanceOf(PersonaNotFoundError);
    expect(await close).toBeUndefined();
    expect(order).toEqual(["read", "close"]);
  });

  test("rejects every operation with the closed error after close", async () => {
    const store = await openSqliteMemoryStore(":memory:");
    await store.create("jev", "I am Jev.");
    await store.close();

    for (const call of [
      store.create("amy", "I am Amy."),
      store.read("jev", { counterparts: [] }),
      store.write("jev", { add: [itemA()] }),
      store.delete("jev", ["m1"]),
    ]) {
      const error = await thrown(call);
      expect(error).toBeInstanceOf(MemoryStoreClosedError);
      expect((error as Error).name).toBe("MemoryStoreClosedError");
      expect((error as Error).message).toBe(closedMessage);
    }
  });

  test("rejects with the closed error, not an argument error, for invalid arguments after close", async () => {
    const store = await openSqliteMemoryStore(":memory:");
    const before = await thrown(store.create("", "I am Amy."));
    expect(before).toBeInstanceOf(MemoryArgumentError);
    expect((before as MemoryArgumentError).kind).toBe("empty-id");
    await store.close();

    expect(await thrown(store.create("", "I am Amy."))).toBeInstanceOf(
      MemoryStoreClosedError,
    );
  });

  test("does not reach the file for a call made after close", async () => {
    const path = await tempPath();
    const store = await openSqliteMemoryStore(path);
    await store.create("jev", "I am Jev.");
    await store.close();

    await thrown(store.create("amy", "I am Amy."));

    const other = await openSqliteMemoryStore(path);
    expect(
      await thrown(other.read("amy", { counterparts: [] })),
    ).toBeInstanceOf(PersonaNotFoundError);
  });

  test("rejects a call made while close is still pending", async () => {
    const store = await openSqliteMemoryStore(await tempPath());
    await store.create("jev", "I am Jev.");

    const close = store.close();
    const read = store.read("jev", { counterparts: [] });

    expect(await thrown(read)).toBeInstanceOf(MemoryStoreClosedError);
    expect(await close).toBeUndefined();
  });

  test("resolves a repeated close after the first one", async () => {
    const store = await openSqliteMemoryStore(await tempPath());
    await store.create("jev", "I am Jev.");
    const order: string[] = [];

    const write = track(
      order,
      "write",
      store.write("jev", { add: [itemA()] }),
    );
    const first = track(order, "first", store.close());
    const second = track(order, "second", store.close());

    expect(await write).toEqual({});
    expect(await first).toBeUndefined();
    expect(await second).toBeUndefined();
    expect(order).toEqual(["write", "first", "second"]);
    expect(await store.close()).toBeUndefined();
  });

  test("releases the closed store's file but not another file's", async () => {
    const pathP = await tempPath();
    const pathQ = await tempPath();
    const storeP = await openSqliteMemoryStore(pathP);
    const storeQ = await openSqliteMemoryStore(pathQ);
    for (const store of [storeP, storeQ]) {
      await store.create("jev", "I am Jev.");
      await store.read("jev", { counterparts: [] });
    }
    expect(openDescriptors(pathP)).toBeGreaterThanOrEqual(1);

    await storeP.close();
    const deadline = Date.now() + 2000;
    while (openDescriptors(pathP) > 0 && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 100));
    }

    expect(openDescriptors(pathP)).toBe(0);
    expect(openDescriptors(pathQ)).toBeGreaterThanOrEqual(1);
    await storeQ.close();
  });

  test("keeps another store on the same file working", async () => {
    const path = await tempPath();
    const closed = await openSqliteMemoryStore(path);
    const open = await openSqliteMemoryStore(path);
    await closed.create("jev", "I am Jev.");
    await closed.close();

    expect(await open.write("jev", { add: [itemA()] })).toEqual({});
    expect(
      (await open.read("jev", { counterparts: ["alice"] })).items,
    ).toEqual([{ ...itemA(), misses: 0 }]);
  });
});
