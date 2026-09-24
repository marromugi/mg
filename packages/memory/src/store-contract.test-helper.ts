import { describe, expect, test } from "vitest";
import {
  MemoryArgumentError,
  MemoryConflictError,
  MemoryItemExistsError,
  MemoryItemNotFoundError,
  PersonaExistsError,
  PersonaNotFoundError,
} from "./errors.js";
import type { MemoryStore, NewMemoryItem } from "./types.js";

const thrown = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
};

const itemA = (): NewMemoryItem => ({
  id: "m1",
  counterpart: "alice",
  text: "likes cats",
  createdAt: 100,
});

const itemB = (): NewMemoryItem => ({
  id: "m2",
  counterpart: "alice",
  text: "lives in Kyoto",
  createdAt: 100,
});

const itemC = (): NewMemoryItem => ({
  id: "m3",
  counterpart: "bob",
  text: "plays go",
  createdAt: 50,
});

export const describeMemoryStoreContract = (
  name: string,
  open: () => Promise<MemoryStore>,
): void => {
  // name は呼び出し側の実装ごとに変わる想定です。
  // oxlint-disable-next-line vitest/valid-title
  describe(name, () => {
    test("creates a persona at version 1 with no items and no summary property", async () => {
      const store = await open();
      await store.create("jev", "I am Jev.");

      const view = await store.read("jev", { counterparts: [] });

      expect(view).toEqual({
        persona: { text: "I am Jev.", version: 1 },
        items: [],
      });
      expect(Object.hasOwn(view, "summary")).toBe(false);
    });

    test("refuses to create a persona id that already exists", async () => {
      const store = await open();
      await store.create("jev", "I am Jev.");

      const error = await thrown(store.create("jev", "again"));

      expect(error).toBeInstanceOf(PersonaExistsError);
      expect((error as PersonaExistsError).personaId).toBe("jev");
    });

    test("orders read items by newest created time first, breaking ties by insertion order, after one write adds several items", async () => {
      const store = await open();
      await store.create("jev", "I am Jev.");
      await store.write("jev", { add: [itemA(), itemB(), itemC()] });

      const view = await store.read("jev", {
        counterparts: ["alice", "bob"],
        conversation: "t1",
      });

      expect(view.items).toEqual([
        { ...itemB(), misses: 0 },
        { ...itemA(), misses: 0 },
        { ...itemC(), misses: 0 },
      ]);
      expect(Object.hasOwn(view, "summary")).toBe(false);
    });

    test("returns only the items for the requested counterparts", async () => {
      const store = await open();
      await store.create("jev", "I am Jev.");
      await store.write("jev", { add: [itemA(), itemB(), itemC()] });

      const view = await store.read("jev", { counterparts: ["bob"] });

      expect(view.items).toEqual([{ ...itemC(), misses: 0 }]);
    });

    test("writes a new conversation summary at version 0 and reads it back at version 1", async () => {
      const store = await open();
      await store.create("jev", "I am Jev.");

      await store.write("jev", {
        summary: {
          conversation: "t1",
          text: "we met",
          expectedVersion: 0,
        },
      });
      const view = await store.read("jev", {
        counterparts: [],
        conversation: "t1",
      });

      expect(view.summary).toEqual({ text: "we met", version: 1 });
    });

    test("refuses a write when persona and summary versions do not match, reporting the persona mismatch before the summary mismatch, and leaves both unchanged", async () => {
      const store = await open();
      await store.create("jev", "I am Jev.");
      await store.write("jev", {
        summary: {
          conversation: "t1",
          text: "we met",
          expectedVersion: 0,
        },
      });

      const error = await thrown(
        store.write("jev", {
          persona: { text: "new", expectedVersion: 2 },
          summary: {
            conversation: "t1",
            text: "x",
            expectedVersion: 0,
          },
        }),
      );

      expect(error).toBeInstanceOf(MemoryConflictError);
      expect((error as MemoryConflictError).mismatches).toEqual([
        { kind: "persona", expectedVersion: 2, actualVersion: 1 },
        {
          kind: "summary",
          key: "t1",
          expectedVersion: 0,
          actualVersion: 1,
        },
      ]);
      const view = await store.read("jev", {
        counterparts: [],
        conversation: "t1",
      });
      expect(view.persona).toEqual({ text: "I am Jev.", version: 1 });
      expect(view.summary).toEqual({ text: "we met", version: 1 });
    });

    test("returns updated miss counts for missed items, accumulating misses across writes while hits reset to zero", async () => {
      const store = await open();
      await store.create("jev", "I am Jev.");
      await store.write("jev", { add: [itemA(), itemB(), itemC()] });

      const firstResult = await store.write("jev", {
        hits: ["m1"],
        misses: ["m2", "m3"],
      });
      expect(firstResult).toEqual({ m2: 1, m3: 1 });

      const secondResult = await store.write("jev", { misses: ["m2"] });
      expect(secondResult).toEqual({ m2: 2 });

      const view = await store.read("jev", {
        counterparts: ["alice", "bob"],
      });
      const missesById = Object.fromEntries(
        view.items.map((item) => [item.id, item.misses]),
      );
      expect(missesById).toEqual({ m1: 0, m2: 2, m3: 1 });
    });

    test("resets an item's miss count to zero when it is hit", async () => {
      const store = await open();
      await store.create("jev", "I am Jev.");
      await store.write("jev", { add: [itemA(), itemB(), itemC()] });
      await store.write("jev", { hits: ["m1"], misses: ["m2", "m3"] });
      await store.write("jev", { misses: ["m2"] });

      await store.write("jev", { hits: ["m2"] });

      const view = await store.read("jev", {
        counterparts: ["alice", "bob"],
      });
      const m2 = view.items.find((item) => item.id === "m2");
      expect(m2?.misses).toBe(0);
    });

    test("refuses to add an item id that already exists and refuses to hit or miss item ids that were never stored, leaving items unchanged either time", async () => {
      const store = await open();
      await store.create("jev", "I am Jev.");
      await store.write("jev", { add: [itemA(), itemB(), itemC()] });

      const existsError = await thrown(
        store.write("jev", {
          add: [itemA(), { ...itemB(), id: "m2" }],
        }),
      );
      expect(existsError).toBeInstanceOf(MemoryItemExistsError);
      expect((existsError as MemoryItemExistsError).itemIds).toEqual([
        "m1",
        "m2",
      ]);

      const notFoundError = await thrown(
        store.write("jev", {
          hits: ["m8", "m9"],
          misses: ["m1", "m7"],
        }),
      );
      expect(notFoundError).toBeInstanceOf(MemoryItemNotFoundError);
      expect(
        (notFoundError as MemoryItemNotFoundError).itemIds,
      ).toEqual(["m8", "m9", "m7"]);

      const view = await store.read("jev", {
        counterparts: ["alice", "bob"],
      });
      expect(view.items).toEqual([
        { ...itemB(), misses: 0 },
        { ...itemA(), misses: 0 },
        { ...itemC(), misses: 0 },
      ]);
    });

    test("deletes the requested items", async () => {
      const store = await open();
      await store.create("jev", "I am Jev.");
      await store.write("jev", { add: [itemA(), itemB(), itemC()] });

      await store.delete("jev", ["m1", "m3"]);

      const view = await store.read("jev", {
        counterparts: ["alice", "bob"],
      });
      expect(view.items).toEqual([{ ...itemB(), misses: 0 }]);
    });

    test("refuses to delete when one of the ids was never stored, and leaves the existing item in place", async () => {
      const store = await open();
      await store.create("jev", "I am Jev.");
      await store.write("jev", { add: [itemA(), itemB(), itemC()] });

      const error = await thrown(store.delete("jev", ["m1", "m9"]));

      expect(error).toBeInstanceOf(MemoryItemNotFoundError);
      expect((error as MemoryItemNotFoundError).itemIds).toEqual([
        "m9",
      ]);
      const view = await store.read("jev", { counterparts: ["alice"] });
      expect(view.items.some((item) => item.id === "m1")).toBe(true);
    });

    test("refuses each invalid argument with the matching kind, without changing anything, checking arguments only after existence for read, write, and delete", async () => {
      const store = await open();
      await store.create("jev", "I am Jev.");

      const invocations: Array<{
        kind: string;
        call: () => Promise<unknown>;
      }> = [
        { kind: "empty-id", call: () => store.create(" ", "x") },
        { kind: "empty-text", call: () => store.create("k", " ") },
        { kind: "empty-change", call: () => store.write("jev", {}) },
        {
          kind: "empty-change",
          call: () => store.write("jev", { add: [], hits: [] }),
        },
        {
          kind: "duplicate-id",
          call: () =>
            store.write("jev", {
              add: [itemA(), { ...itemB(), id: "m1" }],
            }),
        },
        {
          kind: "hit-and-miss",
          call: () =>
            store.write("jev", { hits: ["m1"], misses: ["m1"] }),
        },
        {
          kind: "invalid-version",
          call: () =>
            store.write("jev", {
              persona: { text: "x", expectedVersion: -1 },
            }),
        },
        {
          kind: "invalid-time",
          call: () =>
            store.write("jev", {
              add: [{ ...itemA(), createdAt: Number.NaN }],
            }),
        },
        { kind: "empty-list", call: () => store.delete("jev", []) },
        {
          kind: "duplicate-id",
          call: () => store.read("jev", { counterparts: ["a", "a"] }),
        },
        {
          kind: "invalid-time",
          call: () =>
            store.write("jev", {
              persona: { text: "p", expectedVersion: 1 },
              add: [{ ...itemA(), createdAt: Number.NaN }],
            }),
        },
      ];

      for (const { kind, call } of invocations) {
        const error = await thrown(call());
        expect(error).toBeInstanceOf(MemoryArgumentError);
        expect((error as MemoryArgumentError).kind).toBe(kind);

        const view = await store.read("jev", {
          counterparts: ["alice"],
          conversation: "t1",
        });
        expect(view).toEqual({
          persona: { text: "I am Jev.", version: 1 },
          items: [],
        });

        const kError = await thrown(
          store.read("k", { counterparts: [] }),
        );
        expect(kError).toBeInstanceOf(PersonaNotFoundError);
      }
    });

    test("reports the persona as not found before checking arguments, for read, write, and delete", async () => {
      const store = await open();

      const readError = await thrown(
        store.read("nobody", { counterparts: [] }),
      );
      expect(readError).toBeInstanceOf(PersonaNotFoundError);
      expect((readError as PersonaNotFoundError).personaId).toBe(
        "nobody",
      );

      const writeError = await thrown(
        store.write("nobody", { hits: [] }),
      );
      expect(writeError).toBeInstanceOf(PersonaNotFoundError);
      expect((writeError as PersonaNotFoundError).personaId).toBe(
        "nobody",
      );

      const deleteError = await thrown(store.delete("nobody", []));
      expect(deleteError).toBeInstanceOf(PersonaNotFoundError);
      expect((deleteError as PersonaNotFoundError).personaId).toBe(
        "nobody",
      );
    });

    test("writes persona and summary together when both versions match, returning an empty result", async () => {
      const store = await open();
      await store.create("jev", "I am Jev.");
      await store.write("jev", {
        summary: {
          conversation: "t1",
          text: "we met",
          expectedVersion: 0,
        },
      });

      const result = await store.write("jev", {
        persona: {
          text: "I am Jev, a cat person.",
          expectedVersion: 1,
        },
        summary: {
          conversation: "t1",
          text: "we met twice",
          expectedVersion: 1,
        },
      });

      expect(result).toEqual({});
      const view = await store.read("jev", {
        counterparts: [],
        conversation: "t1",
      });
      expect(view).toEqual({
        persona: { text: "I am Jev, a cat person.", version: 2 },
        items: [],
        summary: { text: "we met twice", version: 2 },
      });
    });
  });
};
