import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInbox,
  type InboxItem,
  type InboxOutcome,
} from "@mg/inbox";
import { openSqliteInboxStore } from "@mg/inbox/sqlite";

type Span = { start: number; end: number };

const path = join(
  await mkdtemp(join(tmpdir(), "inbox-restart-")),
  "inbox.db",
);
const t0 = Date.now();
const since = (): number => Date.now() - t0;
const spans = new Map<string, Span>();
const runs = new Map<string, number>();
const settled = new Map<string, InboxOutcome>();
const waiters = new Set<() => void>();

const open = async () => {
  const store = await openSqliteInboxStore(path);
  const inbox = createInbox({
    store,
    run: async (item: InboxItem) => {
      const name = String(item.input);
      runs.set(name, (runs.get(name) ?? 0) + 1);
      const span = { start: since(), end: -1 };
      spans.set(name, span);
      if (name === "boom") {
        span.end = since();
        throw new Error("the run was told to fail");
      }
      if (name.startsWith("slow")) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      span.end = since();
    },
    onSettle: (item, outcome) => {
      settled.set(String(item.input), outcome);
      for (const wake of waiters) {
        wake();
      }
    },
  });
  return { store, inbox };
};

const settledAll = (names: string[]): Promise<void> =>
  new Promise((resolve) => {
    const check = (): void => {
      if (names.every((name) => settled.has(name))) {
        waiters.delete(check);
        resolve();
      }
    };
    waiters.add(check);
    check();
  });

const failures: string[] = [];
const expectThat = (ok: boolean, message: string): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) {
    failures.push(message);
  }
};

// V1: input due in 2 seconds survives a close and a reopen.
const first = await open();
await first.inbox.start();
const dueAt = Date.now() + 2000;
await first.inbox.add("restart", "restart", { dueAt });
await first.inbox.close();
await first.store.close();
console.log(`closed at +${since()}ms with input due in 2000ms`);

const second = await open();
await second.inbox.start();
await settledAll(["restart"]);
const ran = spans.get("restart")!;
console.log(
  `input ran after reopen at +${ran.start}ms (${runs.get("restart")} time)`,
);
expectThat(t0 + ran.start >= dueAt, "ran at or after its due time");
expectThat(runs.get("restart") === 1, "ran exactly once");

// V2: one conversation runs in order without overlap; another is not held.
await second.inbox.add("seq", "slow-1");
await new Promise((resolve) => setTimeout(resolve, 200));
await second.inbox.add("seq", "slow-2");
await second.inbox.add("other", "other-1");
// V3: a run that throws is failed and the next input still runs.
await second.inbox.add("fail", "boom");
await second.inbox.add("fail", "after-boom");
await settledAll(["slow-1", "slow-2", "other-1", "boom", "after-boom"]);

const s1 = spans.get("slow-1")!;
const s2 = spans.get("slow-2")!;
const o1 = spans.get("other-1")!;
console.log(
  `slow-1 ${s1.start}-${s1.end}ms, slow-2 ${s2.start}-${s2.end}ms, other-1 ${o1.start}-${o1.end}ms`,
);
expectThat(s2.start >= s1.end, "slow-2 started after slow-1 ended");
expectThat(
  o1.end <= s1.end,
  "other-1 ran without waiting for the busy conversation",
);
console.log(`boom: ${JSON.stringify(settled.get("boom"))}`);
expectThat(
  JSON.stringify(settled.get("boom")) ===
    JSON.stringify({
      kind: "failed",
      reason: "the run was told to fail",
    }),
  "boom is failed with the thrown message",
);
expectThat(
  settled.get("after-boom")?.kind === "done",
  "the next input of that conversation ran",
);
expectThat(runs.get("boom") === 1, "boom was not run again");

await second.inbox.close();
await second.store.close();
process.exitCode = failures.length === 0 ? 0 : 1;
