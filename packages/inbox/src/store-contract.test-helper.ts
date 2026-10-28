import { describe, expect, test } from "vitest";
import type { InboxStore } from "./types.js";

export const describeStoreContract = (
  name: string,
  open: () => Promise<InboxStore>,
): void => {
  describe(`${name} as an InboxStore`, () => {
    test("lists pending items ordered by due time, then by when added", async () => {
      const store = await open();
      await store.add(
        { conversationId: "c", input: "late", dueAt: 300 },
        10,
      );
      await store.add(
        { conversationId: "c", input: "second", dueAt: 100 },
        30,
      );
      await store.add(
        { conversationId: "c", input: "first", dueAt: 100 },
        20,
      );
      await store.add(
        { conversationId: "d", input: "same", dueAt: 100 },
        30,
      );

      const pending = await store.pending();

      expect(pending.map((item) => item.input)).toEqual([
        "first",
        "second",
        "same",
        "late",
      ]);
    });

    test("gives each added item its own id and the time it was added", async () => {
      const store = await open();

      const a = await store.add(
        { conversationId: "c", input: { n: 1 }, dueAt: 5 },
        7,
      );
      const b = await store.add(
        { conversationId: "c", input: [1, null], dueAt: 5 },
        8,
      );

      expect(a.id).not.toBe(b.id);
      expect(a).toMatchObject({
        conversationId: "c",
        input: { n: 1 },
        dueAt: 5,
        addedAt: 7,
      });
      expect((await store.pending()).map((item) => item.input)).toEqual(
        [{ n: 1 }, [1, null]],
      );
    });

    test("drops a settled item from pending, whether it is done or failed", async () => {
      const store = await open();
      const a = await store.add(
        { conversationId: "c", input: "a", dueAt: 1 },
        1,
      );
      const b = await store.add(
        { conversationId: "c", input: "b", dueAt: 1 },
        2,
      );
      await store.add({ conversationId: "c", input: "c", dueAt: 1 }, 3);

      await store.settle(a.id, { kind: "done" });
      await store.settle(b.id, { kind: "failed", reason: "boom" });

      expect((await store.pending()).map((item) => item.input)).toEqual(
        ["c"],
      );
    });
  });
};
