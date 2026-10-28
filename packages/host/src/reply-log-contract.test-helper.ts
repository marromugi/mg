import { describe, expect, test } from "vitest";
import type { ReplyFilter, ReplyLog, ReplyRecord } from "./types.js";

const entry = (inputId: string, text: string) =>
  ({
    kind: "reply",
    conversationId: "c",
    inputId,
    text,
  }) as const;

const inConversation = (id: string, inputId: string) =>
  ({
    kind: "reply",
    conversationId: id,
    inputId,
    text: inputId,
  }) as const;

export const describeReplyLogContract = (
  name: string,
  open: () => Promise<ReplyLog>,
): void => {
  describe(`${name} as a ReplyLog`, () => {
    test("numbers records from 1 and reads those after a cursor", async () => {
      const log = await open();
      await log.append(entry("a", "one"));
      await log.append({
        kind: "failed",
        conversationId: "c",
        inputId: "b",
        reason: "broke",
      });
      await log.append(entry("c", "three"));

      const after = await log.read(1, 10);

      expect(after).toEqual([
        {
          cursor: 2,
          kind: "failed",
          conversationId: "c",
          inputId: "b",
          reason: "broke",
        },
        { cursor: 3, ...entry("c", "three") },
      ]);
      expect(await log.read(0, 1)).toHaveLength(1);
      await log.close();
    });

    test("keeps a scheduled record, which does not count as an answer to its input", async () => {
      const log = await open();
      await log.append({
        kind: "scheduled",
        conversationId: "c",
        inputId: "a",
        callIndex: 1,
        dueAt: 61000,
        note: "stand up",
      });

      expect(await log.read(0, 10)).toEqual([
        {
          cursor: 1,
          kind: "scheduled",
          conversationId: "c",
          inputId: "a",
          callIndex: 1,
          dueAt: 61000,
          note: "stand up",
        },
      ]);
      expect((await log.scheduledFor("a", 1))?.dueAt).toBe(61000);
      expect(await log.scheduledFor("a", 2)).toBeUndefined();
      expect(await log.scheduledFor("b", 1)).toBeUndefined();
      expect(await log.hasReplyFor("a")).toBe(false);
      await log.append(entry("a", "one"));
      expect(await log.hasReplyFor("a")).toBe(true);
      await log.close();
    });

    test("watches records already there, then each new one, until aborted", async () => {
      const log = await open();
      await log.append(entry("a", "one"));
      const abort = new AbortController();
      const seen: ReplyRecord[] = [];
      const watching = (async () => {
        for await (const record of log.watch(0, abort.signal)) {
          seen.push(record);
        }
      })();

      await log.append(entry("b", "two"));
      await new Promise((resolve) => setTimeout(resolve, 50));
      abort.abort();
      await watching;

      expect(seen.map((r) => r.cursor)).toEqual([1, 2]);
      await log.close();
    });

    test("reads and watches only records of the named conversations, with cursors of the whole log", async () => {
      const log = await open();
      await log.append(inConversation("discord:a", "1"));
      await log.append(inConversation("other:b", "2"));
      await log.append(inConversation("discord:c", "3"));
      await log.append(inConversation("discordx", "4"));
      await log.append(inConversation("odd%_", "5"));
      await log.append(inConversation("oddxx", "6"));

      const cursors = async (filter: ReplyFilter) =>
        (await log.read(0, 10, filter)).map((r) => r.cursor);

      expect(await cursors({ prefix: "discord:" })).toEqual([1, 3]);
      expect(await cursors({ conversations: ["other:b"] })).toEqual([
        2,
      ]);
      expect(
        await cursors({
          conversations: ["other:b"],
          prefix: "discord:",
        }),
      ).toEqual([1, 2, 3]);
      expect(await cursors({ prefix: "odd%_" })).toEqual([5]);
      expect(await cursors({})).toEqual([1, 2, 3, 4, 5, 6]);
      expect(
        (await log.read(1, 1, { prefix: "discord:" })).map(
          (r) => r.cursor,
        ),
      ).toEqual([3]);

      const abort = new AbortController();
      const seen: number[] = [];
      const watching = (async () => {
        for await (const record of log.watch(0, abort.signal, {
          prefix: "discord:",
        })) {
          seen.push(record.cursor);
        }
      })();
      await log.append(inConversation("other:b", "7"));
      await log.append(inConversation("discord:a", "8"));
      await new Promise((resolve) => setTimeout(resolve, 50));
      abort.abort();
      await watching;

      expect(seen).toEqual([1, 3, 8]);
      await log.close();
    });
  });
};
