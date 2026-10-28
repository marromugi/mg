import { describe, expect, test } from "vitest";
import type { ReplyLog, ReplyRecord } from "./types.js";

const entry = (inputId: string, text: string) =>
  ({
    kind: "reply",
    conversationId: "c",
    inputId,
    text,
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
        dueAt: 61000,
        note: "stand up",
      });

      expect(await log.read(0, 10)).toEqual([
        {
          cursor: 1,
          kind: "scheduled",
          conversationId: "c",
          inputId: "a",
          dueAt: 61000,
          note: "stand up",
        },
      ]);
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
  });
};
