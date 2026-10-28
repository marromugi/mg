import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { expect, test } from "vitest";
import { InboxItemUnreadableError } from "../errors.js";
import { describeStoreContract } from "../store-contract.test-helper.js";
import { openSqliteInboxStore } from "./store.js";

const freshPath = async (): Promise<string> =>
  join(await mkdtemp(join(tmpdir(), "inbox-")), "inbox.db");

describeStoreContract("the SQLite store", async () =>
  openSqliteInboxStore(await freshPath()),
);

test("keeps pending items after the file is reopened", async () => {
  const path = await freshPath();
  const first = await openSqliteInboxStore(path);
  const done = await first.add(
    { conversationId: "c", input: "done", dueAt: 1 },
    1,
  );
  await first.add({ conversationId: "c", input: "left", dueAt: 2 }, 2);
  await first.settle(done.id, { kind: "done" });
  await first.close();

  const second = await openSqliteInboxStore(path);

  expect((await second.pending()).map((item) => item.input)).toEqual([
    "left",
  ]);
  await second.close();
});

test("rejects the open naming the item whose stored input is not JSON", async () => {
  const path = await freshPath();
  const store = await openSqliteInboxStore(path);
  const item = await store.add(
    { conversationId: "c", input: "ok", dueAt: 1 },
    1,
  );
  await store.close();
  const client = createClient({ url: `file:${path}` });
  await client.execute("update inbox_items set input = '{broken'");
  client.close();

  const error = await openSqliteInboxStore(path).catch(
    (e: unknown) => e,
  );

  expect(error).toBeInstanceOf(InboxItemUnreadableError);
  expect((error as Error).message).toContain(`"${item.id}"`);
});
