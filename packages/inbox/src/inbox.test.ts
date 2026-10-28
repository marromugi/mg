import { describe, expect, test } from "vitest";
import { InboxClosedError } from "./errors.js";
import { createInbox } from "./inbox.js";
import { createMemoryInboxStore } from "./memory.js";
import type { Clock, InboxItem, InboxStore } from "./types.js";

const fakeClock = (): Clock & {
  advance(ms: number): void;
} => {
  let now = 1000;
  let timer: { at: number; fn: () => void } | undefined;
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      const entry = { at: now + ms, fn };
      timer = entry;
      return () => {
        if (timer === entry) {
          timer = undefined;
        }
      };
    },
    advance(ms) {
      now += ms;
      const due = timer;
      if (due !== undefined && due.at <= now) {
        timer = undefined;
        due.fn();
      }
    },
  };
};

const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 5));

const gate = (): { wait: Promise<void>; open(): void } => {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
};

describe("createInbox", () => {
  test("runs input added without a due time at once", async () => {
    const seen: unknown[] = [];
    const inbox = createInbox({
      store: createMemoryInboxStore(),
      run: async (item) => {
        seen.push(item.input);
      },
    });
    await inbox.start();

    await inbox.add("c", { hello: "world" });
    await tick();

    expect(seen).toEqual([{ hello: "world" }]);
    await inbox.close();
  });

  test("holds input until its due time and then runs it", async () => {
    const clock = fakeClock();
    const seen: unknown[] = [];
    const inbox = createInbox({
      store: createMemoryInboxStore(),
      clock,
      run: async (item) => {
        seen.push(item.input);
      },
    });
    await inbox.start();

    await inbox.add("c", "later", { dueAt: 1500 });
    await tick();
    expect(seen).toEqual([]);
    clock.advance(500);
    await tick();

    expect(seen).toEqual(["later"]);
    await inbox.close();
  });

  test("runs one conversation's items in order added without overlap, while another conversation runs at once", async () => {
    const events: string[] = [];
    const first = gate();
    const inbox = createInbox({
      store: createMemoryInboxStore(),
      run: async (item) => {
        events.push(`start ${String(item.input)}`);
        if (item.input === "a1") {
          await first.wait;
        }
        events.push(`end ${String(item.input)}`);
      },
    });
    await inbox.start();

    await inbox.add("a", "a1");
    await tick();
    await inbox.add("a", "a2");
    await inbox.add("b", "b1");
    await tick();
    expect(events).toEqual(["start a1", "start b1", "end b1"]);
    first.open();
    await tick();

    expect(events).toEqual([
      "start a1",
      "start b1",
      "end b1",
      "end a1",
      "start a2",
      "end a2",
    ]);
    await inbox.close();
  });

  test("marks an item failed with the thrown message and goes on to the next", async () => {
    const settled: [string, unknown][] = [];
    const inbox = createInbox({
      store: createMemoryInboxStore(),
      run: async (item) => {
        if (item.input === "bad") {
          throw new Error("it broke");
        }
      },
      onSettle: (item, outcome) => {
        settled.push([String(item.input), outcome]);
      },
    });
    await inbox.start();

    await inbox.add("c", "bad");
    await inbox.add("c", "good");
    await tick();

    expect(settled).toEqual([
      ["bad", { kind: "failed", reason: "it broke" }],
      ["good", { kind: "done" }],
    ]);
    await inbox.close();
  });

  test("runs an item left pending in the store once started", async () => {
    const store = createMemoryInboxStore();
    await store.add(
      { conversationId: "c", input: "left", dueAt: 1 },
      1,
    );
    const seen: unknown[] = [];
    const inbox = createInbox({
      store,
      run: async (item) => {
        seen.push(item.input);
      },
    });

    await inbox.start();
    await tick();

    expect(seen).toEqual(["left"]);
    await inbox.close();
  });

  test("never runs an item twice and rejects close when its outcome cannot be recorded", async () => {
    const base = createMemoryInboxStore();
    const store: InboxStore = {
      ...base,
      settle: async () => {
        throw new Error("disk full");
      },
    };
    const seen: unknown[] = [];
    const inbox = createInbox({
      store,
      run: async (item) => {
        seen.push(item.input);
      },
    });
    await inbox.start();

    await inbox.add("c", "one");
    await inbox.add("c", "two");
    await tick();

    expect(seen).toEqual(["one"]);
    await expect(inbox.close()).rejects.toThrow(/disk full/);
    expect((await store.pending()).length).toBe(2);
  });

  test("rejects add once closed, and leaves pending items in the store", async () => {
    const store = createMemoryInboxStore();
    const inbox = createInbox({ store, run: async () => {} });
    await inbox.start();
    await inbox.add("c", "later", { dueAt: Date.now() + 60_000 });

    await inbox.close();

    await expect(inbox.add("c", "x")).rejects.toBeInstanceOf(
      InboxClosedError,
    );
    const pending: InboxItem[] = await store.pending();
    expect(pending.map((item) => item.input)).toEqual(["later"]);
  });
});
