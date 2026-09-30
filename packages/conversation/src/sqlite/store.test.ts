import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { describe, expect, test } from "vitest";
import {
  ConversationConflictError,
  ConversationEntryUnreadableError,
} from "../errors.js";
import { describeStoreContract } from "../store-contract.test-helper.js";
import type { ConversationEntry } from "../types.js";
import { openSqliteConversationStore } from "./store.js";

const thrown = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
};

const entryA: ConversationEntry = {
  messages: [
    { role: "user", content: "a" },
    { role: "assistant", parts: [{ type: "text", text: "A" }] },
  ],
};

const entryB: ConversationEntry = {
  messages: [
    { role: "user", content: "b" },
    { role: "assistant", parts: [{ type: "text", text: "B" }] },
  ],
};

const entryWithCall = (id: string): ConversationEntry => ({
  messages: [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      parts: [
        {
          type: "tool-call",
          id,
          name: "echo",
          arguments: { text: "ping" },
        },
      ],
    },
    { role: "tool", toolCallId: id, content: "pong" },
  ],
});

const openSecondClient = (path: string) =>
  createClient({ url: pathToFileURL(resolve(path)).href });

const newDbPath = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mg-conversation-sqlite-"));
  return join(dir, "nested", "conversations.db");
};

describeStoreContract("SQLite の会話の保存", async () =>
  openSqliteConversationStore(await newDbPath()),
);

describe("openSqliteConversationStore", () => {
  test("reads entries appended through one connection after reopening the same file with another", async () => {
    const path = await newDbPath();
    const first = await openSqliteConversationStore(path);
    await first.create("jev");
    await first.append("jev", entryA, 0);

    const second = await openSqliteConversationStore(path);
    const slice = await second.read("jev", { kind: "all" });

    expect(slice).toEqual({
      entries: [entryA],
      length: 1,
      toolCalls: [],
    });
  });

  test("rejects a read covering unreadable rows with the conversation, the lowest broken position, and the parse error", async () => {
    const path = await newDbPath();
    const store = await openSqliteConversationStore(path);
    await store.create("jev");
    await store.append("jev", entryA, 0);
    await store.append("jev", entryB, 1);
    await store.append("jev", entryA, 2);

    const other = createClient({
      url: pathToFileURL(resolve(path)).href,
    });
    await other.execute(
      "update entries set messages = '{' where position in (1, 2)",
    );
    other.close();

    const error = await thrown(store.read("jev", { kind: "all" }));

    expect(error).toBeInstanceOf(ConversationEntryUnreadableError);
    const unreadable = error as ConversationEntryUnreadableError;
    expect(unreadable.conversationId).toBe("jev");
    expect(unreadable.position).toBe(1);
    expect(unreadable.cause).toBeInstanceOf(SyntaxError);
    expect(unreadable.message).toBe(
      `Conversation "jev" has a stored entry at position 1 that cannot be read: ${(unreadable.cause as SyntaxError).message}.`,
    );
  });

  test("reads stored entries sharing a tool-call id, and appends an entry with another id", async () => {
    const path = await newDbPath();
    const store = await openSqliteConversationStore(path);
    await store.create("c");
    await store.append("c", entryWithCall("k"), 0);
    const other = openSecondClient(path);
    await other.execute({
      sql: "insert into entries (conversation_id, position, messages) values (?, ?, ?)",
      args: ["c", 1, JSON.stringify(entryWithCall("k").messages)],
    });
    other.close();

    await store.append("c", entryWithCall("z"), 2);
    const slice = await store.read("c", { kind: "all" });

    expect(slice.length).toBe(3);
    expect(slice.toolCalls).toEqual([
      { id: "k", position: 0 },
      { id: "k", position: 1 },
      { id: "z", position: 2 },
    ]);
  });

  test("rejects a last-1 read and an append when a row outside the range is not valid JSON", async () => {
    const path = await newDbPath();
    const store = await openSqliteConversationStore(path);
    await store.create("c");
    await store.append("c", entryWithCall("a"), 0);
    await store.append(
      "c",
      { messages: [{ role: "user", content: "hi" }] },
      1,
    );
    const other = openSecondClient(path);
    await other.execute(
      "update entries set messages = '{' where position = 0",
    );
    other.close();

    const readError = await thrown(
      store.read("c", { kind: "last", count: 1 }),
    );
    const appendError = await thrown(
      store.append("c", entryWithCall("z"), 2),
    );

    for (const error of [readError, appendError]) {
      expect(error).toBeInstanceOf(ConversationEntryUnreadableError);
      expect(
        (error as ConversationEntryUnreadableError).conversationId,
      ).toBe("c");
      expect((error as ConversationEntryUnreadableError).position).toBe(
        0,
      );
    }
  });

  test("lets the first of two stores opened on the same file append, and rejects the second with the conflict, leaving only the first entry", async () => {
    const path = await newDbPath();
    const first = await openSqliteConversationStore(path);
    const second = await openSqliteConversationStore(path);
    await first.create("jev");

    await first.append("jev", entryA, 0);
    const error = await thrown(second.append("jev", entryB, 0));

    expect(error).toBeInstanceOf(ConversationConflictError);
    expect((error as ConversationConflictError).expectedLength).toBe(0);
    expect((error as ConversationConflictError).actualLength).toBe(1);
    const fromFirst = await first.read("jev", { kind: "all" });
    expect(fromFirst.entries).toEqual([entryA]);
    const fromSecond = await second.read("jev", { kind: "all" });
    expect(fromSecond.entries).toEqual([entryA]);
  });

  test("lets exactly one of two overlapping appends on the same file succeed, and rejects the other with the conflict", async () => {
    const path = await newDbPath();
    const first = await openSqliteConversationStore(path);
    const second = await openSqliteConversationStore(path);
    await first.create("jev");

    const [firstOutcome, secondOutcome] = await Promise.allSettled([
      first.append("jev", entryA, 0),
      second.append("jev", entryB, 0),
    ]);
    const outcomes = [firstOutcome, secondOutcome];

    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    const [rejected] = outcomes.filter(
      (outcome) => outcome.status === "rejected",
    );
    if (rejected === undefined) {
      throw new Error("expected one of the two appends to reject");
    }
    expect(rejected.reason).toBeInstanceOf(ConversationConflictError);
    expect(
      (rejected.reason as ConversationConflictError).expectedLength,
    ).toBe(0);
    expect(
      (rejected.reason as ConversationConflictError).actualLength,
    ).toBe(1);

    const winner =
      firstOutcome.status === "fulfilled" ? entryA : entryB;
    const fromFirst = await first.read("jev", { kind: "all" });
    expect(fromFirst).toEqual({
      entries: [winner],
      length: 1,
      toolCalls: [],
    });
    const fromSecond = await second.read("jev", { kind: "all" });
    expect(fromSecond).toEqual({
      entries: [winner],
      length: 1,
      toolCalls: [],
    });
  });

  test("lets exactly one of two overlapping appends on the same in-memory store succeed, and rejects the other with the conflict", async () => {
    const store = await openSqliteConversationStore(":memory:");
    await store.create("jev");

    const [firstOutcome, secondOutcome] = await Promise.allSettled([
      store.append("jev", entryA, 0),
      store.append("jev", entryB, 0),
    ]);
    const outcomes = [firstOutcome, secondOutcome];

    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    const [rejected] = outcomes.filter(
      (outcome) => outcome.status === "rejected",
    );
    if (rejected === undefined) {
      throw new Error("expected one of the two appends to reject");
    }
    expect(rejected.reason).toBeInstanceOf(ConversationConflictError);
    expect(
      (rejected.reason as ConversationConflictError).expectedLength,
    ).toBe(0);
    expect(
      (rejected.reason as ConversationConflictError).actualLength,
    ).toBe(1);

    const winner =
      firstOutcome.status === "fulfilled" ? entryA : entryB;
    const slice = await store.read("jev", { kind: "all" });
    expect(slice).toEqual({
      entries: [winner],
      length: 1,
      toolCalls: [],
    });
  });

  test("rejects with the filesystem error when the store cannot be opened", async () => {
    const dir = await mkdtemp(
      join(tmpdir(), "mg-conversation-sqlite-"),
    );
    writeFileSync(join(dir, "blocker"), "x");

    const error = await thrown(
      openSqliteConversationStore(
        join(dir, "blocker", "sub", "conversations.db"),
      ),
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as NodeJS.ErrnoException).code).toBe("ENOTDIR");
  });

  test("opens an in-memory store without creating a file named :memory: in the working directory", async () => {
    const store = await openSqliteConversationStore(":memory:");
    await store.create("jev");

    const slice = await store.read("jev", { kind: "all" });

    expect(slice).toEqual({ entries: [], length: 0, toolCalls: [] });
    expect(existsSync(join(process.cwd(), ":memory:"))).toBe(false);
  });
});
