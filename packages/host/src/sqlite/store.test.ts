import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { describeReplyLogContract } from "../reply-log-contract.test-helper.js";
import { openSqliteReplyLog } from "./store.js";

const freshPath = async (): Promise<string> =>
  join(await mkdtemp(join(tmpdir(), "replies-")), "replies.db");

describeReplyLogContract("the SQLite log", async () =>
  openSqliteReplyLog(await freshPath()),
);

test("keeps replies and continues the numbering after the file is reopened", async () => {
  const path = await freshPath();
  const first = await openSqliteReplyLog(path);
  await first.append({
    kind: "reply",
    conversationId: "c",
    inputId: "a",
    text: "kept",
  });
  await first.close();

  const second = await openSqliteReplyLog(path);
  const next = await second.append({
    kind: "reply",
    conversationId: "c",
    inputId: "b",
    text: "new",
  });

  expect((await second.read(0, 10)).map((r) => r.cursor)).toEqual([
    1, 2,
  ]);
  expect(next.cursor).toBe(2);
  await second.close();
});
