import { describe, expect, test } from "vitest";
import {
  ConversationConflictError,
  ConversationExistsError,
  ConversationNotFoundError,
  ConversationRangeError,
  EntryNotJsonError,
  EntryToolPairingError,
} from "./errors.js";
import type { ConversationEntry, ConversationStore } from "./types.js";

const thrown = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
};

const entry = (
  userContent: string,
  assistantText: string,
): ConversationEntry => ({
  messages: [
    { role: "user", content: userContent },
    {
      role: "assistant",
      parts: [{ type: "text", text: assistantText }],
    },
  ],
});

const entryA = (): ConversationEntry => entry("a", "A");
const entryB = (): ConversationEntry => entry("b", "B");
const entryC = (): ConversationEntry => entry("c", "C");

const firstMessageContent = (
  conversationEntry: ConversationEntry,
): string | undefined => {
  const [message] = conversationEntry.messages;
  return message.role === "user" ? message.content : undefined;
};

export const describeStoreContract = (
  name: string,
  open: () => Promise<ConversationStore>,
): void => {
  // name は呼び出し側の実装ごとに変わる想定です。
  // oxlint-disable-next-line vitest/valid-title
  describe(name, () => {
    test("reads an empty conversation right after it is created", async () => {
      const store = await open();
      await store.create("jev");

      const slice = await store.read("jev", { kind: "all" });

      expect(slice).toEqual({ entries: [], length: 0 });
    });

    test("refuses to create an id that already exists, and leaves the original conversation untouched", async () => {
      const store = await open();
      await store.create("jev");
      await store.append("jev", entryA(), 0);

      const error = await thrown(store.create("jev"));

      expect(error).toBeInstanceOf(ConversationExistsError);
      expect((error as ConversationExistsError).conversationId).toBe(
        "jev",
      );
      const slice = await store.read("jev", { kind: "all" });
      expect(slice.length).toBe(1);
    });

    test("refuses to read or append to an id that was never created", async () => {
      const store = await open();

      const readError = await thrown(
        store.read("nobody", { kind: "all" }),
      );
      expect(readError).toBeInstanceOf(ConversationNotFoundError);
      expect(
        (readError as ConversationNotFoundError).conversationId,
      ).toBe("nobody");

      const appendError = await thrown(
        store.append("nobody", entryA(), 0),
      );
      expect(appendError).toBeInstanceOf(ConversationNotFoundError);
      expect(
        (appendError as ConversationNotFoundError).conversationId,
      ).toBe("nobody");
    });

    test("reads appended entries back in the order they were appended", async () => {
      const store = await open();
      await store.create("jev");
      await store.append("jev", entryA(), 0);
      await store.append("jev", entryB(), 1);
      await store.append("jev", entryC(), 2);

      const slice = await store.read("jev", { kind: "all" });

      expect(slice.entries).toEqual([entryA(), entryB(), entryC()]);
      expect(slice.length).toBe(3);
    });

    test("reads the last n entries in append order, capped at the conversation length", async () => {
      const store = await open();
      await store.create("jev");
      await store.append("jev", entryA(), 0);
      await store.append("jev", entryB(), 1);
      await store.append("jev", entryC(), 2);

      const last2 = await store.read("jev", { kind: "last", count: 2 });
      expect(last2.entries).toEqual([entryB(), entryC()]);
      expect(last2.length).toBe(3);

      const last10 = await store.read("jev", {
        kind: "last",
        count: 10,
      });
      expect(last10.entries).toEqual([entryA(), entryB(), entryC()]);
      expect(last10.length).toBe(3);
    });

    test("refuses a last-n range whose count is not a positive integer, before checking whether the conversation exists", async () => {
      const store = await open();
      await store.create("jev");

      for (const count of [0, -1, 1.5]) {
        const error = await thrown(
          store.read("jev", { kind: "last", count }),
        );
        expect(error).toBeInstanceOf(ConversationRangeError);
        expect((error as ConversationRangeError).count).toBe(count);
      }

      const rangeErrorBeforeLookup = await thrown(
        store.read("nobody", { kind: "last", count: 0 }),
      );
      expect(rangeErrorBeforeLookup).toBeInstanceOf(
        ConversationRangeError,
      );
      expect(
        (rangeErrorBeforeLookup as ConversationRangeError).count,
      ).toBe(0);
    });

    test("refuses an append whose expected length does not match the actual length, and leaves the conversation untouched", async () => {
      const store = await open();
      await store.create("jev");
      await store.append("jev", entryA(), 0);

      const error = await thrown(store.append("jev", entryB(), 0));

      expect(error).toBeInstanceOf(ConversationConflictError);
      expect((error as ConversationConflictError).expectedLength).toBe(
        0,
      );
      expect((error as ConversationConflictError).actualLength).toBe(1);
      const slice = await store.read("jev", { kind: "all" });
      expect(slice.entries).toEqual([entryA()]);

      const secondError = await thrown(
        store.append("jev", entryB(), 5),
      );
      expect(secondError).toBeInstanceOf(ConversationConflictError);
      expect(
        (secondError as ConversationConflictError).expectedLength,
      ).toBe(5);
      expect(
        (secondError as ConversationConflictError).actualLength,
      ).toBe(1);
    });

    test("refuses to append an entry holding a value that does not survive a JSON round trip, and leaves the conversation untouched", async () => {
      const store = await open();
      await store.create("jev");
      const entryWithUnroundtrippableValue: ConversationEntry = {
        messages: [
          {
            role: "assistant",
            parts: [
              {
                type: "tool-call",
                id: "c1",
                name: "echo",
                arguments: { at: new Date(0) },
              },
            ],
          },
          { role: "tool", toolCallId: "c1", content: "pong" },
        ],
      };

      const error = await thrown(
        store.append("jev", entryWithUnroundtrippableValue, 0),
      );

      expect(error).toBeInstanceOf(EntryNotJsonError);
      const slice = await store.read("jev", { kind: "all" });
      expect(slice).toEqual({ entries: [], length: 0 });
    });

    test("refuses to append an entry whose tool result has no call before it, and leaves the conversation untouched", async () => {
      const store = await open();
      await store.create("jev");
      const entryWithOrphanResult: ConversationEntry = {
        messages: [{ role: "tool", toolCallId: "c1", content: "pong" }],
      };

      const error = await thrown(
        store.append("jev", entryWithOrphanResult, 0),
      );

      expect(error).toBeInstanceOf(EntryToolPairingError);
      expect((error as EntryToolPairingError).kind).toBe(
        "orphan-result",
      );
      const slice = await store.read("jev", { kind: "all" });
      expect(slice.length).toBe(0);
    });

    test("checks entry validity before checking whether the conversation exists", async () => {
      const store = await open();
      const entryWithOrphanResult: ConversationEntry = {
        messages: [{ role: "tool", toolCallId: "c1", content: "pong" }],
      };

      const error = await thrown(
        store.append("nobody", entryWithOrphanResult, 7),
      );

      expect(error).toBeInstanceOf(EntryToolPairingError);
    });

    test("keeps the stored entry unchanged when the caller mutates the object passed to append or the object returned from read", async () => {
      const store = await open();
      await store.create("jev");
      const entryToAppend = entryA();
      await store.append("jev", entryToAppend, 0);
      const [firstMessageIn] = entryToAppend.messages;
      if (firstMessageIn.role === "user") {
        firstMessageIn.content = "changed";
      }

      const firstRead = await store.read("jev", { kind: "all" });
      expect(firstMessageContent(firstRead.entries[0])).toBe("a");
      const [firstMessageOut] = firstRead.entries[0].messages;
      if (firstMessageOut.role === "user") {
        firstMessageOut.content = "changed";
      }

      const secondRead = await store.read("jev", { kind: "all" });
      expect(firstMessageContent(secondRead.entries[0])).toBe("a");
    });

    test("keeps conversations with different ids independent of each other", async () => {
      const store = await open();
      await store.create("one");
      await store.create("two");
      await store.append("one", entryA(), 0);

      const slice = await store.read("two", { kind: "all" });

      expect(slice).toEqual({ entries: [], length: 0 });
    });
  });
};
