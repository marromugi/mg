import { assertJsonInput } from "./checks.js";
import {
  InboxCallbackError,
  InboxClosedError,
  InboxSettleError,
} from "./errors.js";
import type {
  Clock,
  InboxItem,
  InboxOutcome,
  InboxRun,
  InboxStore,
  JsonValue,
} from "./types.js";

// setTimeout fires at once for delays beyond 32-bit milliseconds.
// A clamped timer wakes early, finds nothing due, and arms again.
const MAX_TIMER_MS = 2 ** 31 - 1;

const defaultClock: Clock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
};

export type InboxOptions = {
  store: InboxStore;
  run: InboxRun;
  clock?: Clock;
  onSettle?: (item: InboxItem, outcome: InboxOutcome) => void;
  /** Called when an outcome could not be recorded. */
  onError?: (error: InboxSettleError) => void;
};

export interface Inbox {
  /** Loads pending items and delivers what is due. */
  start(): Promise<void>;
  add(
    conversationId: string,
    input: JsonValue,
    options?: { dueAt?: number },
  ): Promise<InboxItem>;
  /**
   * Stops arming timers and waits for runs in flight. Pending items
   * stay in the store. Rejects with the first settle failure or callback error, if any.
   */
  close(): Promise<void>;
}

type Lane = {
  /** Ordered by dueAt, then by when added. The head is next. */
  queue: InboxItem[];
  running: boolean;
  halted: boolean;
};

const before = (a: InboxItem, b: InboxItem): boolean =>
  a.dueAt < b.dueAt || (a.dueAt === b.dueAt && a.addedAt < b.addedAt);

export const createInbox = (options: InboxOptions): Inbox => {
  const { store, run, onSettle, onError } = options;
  const clock = options.clock ?? defaultClock;

  const lanes = new Map<string, Lane>();
  const known = new Set<string>();
  const inFlight = new Set<Promise<void>>();
  const failures: Error[] = [];
  const notify = (
    callback: "onSettle" | "onError",
    call: () => void,
  ) => {
    try {
      call();
    } catch (cause) {
      failures.push(new InboxCallbackError(callback, cause));
    }
  };
  let started = false;
  let closed = false;
  let cancelTimer: (() => void) | undefined;

  const enqueue = (item: InboxItem): void => {
    if (known.has(item.id)) {
      return;
    }
    known.add(item.id);
    let lane = lanes.get(item.conversationId);
    if (lane === undefined) {
      lane = { queue: [], running: false, halted: false };
      lanes.set(item.conversationId, lane);
    }
    // A running head stays first; later items never overtake it.
    const floor = lane.running ? 1 : 0;
    let at = lane.queue.length;
    while (at > floor && before(item, lane.queue[at - 1])) {
      at -= 1;
    }
    lane.queue.splice(at, 0, item);
  };

  const deliver = async (
    lane: Lane,
    item: InboxItem,
  ): Promise<void> => {
    let outcome: InboxOutcome;
    try {
      await run(structuredClone(item));
      outcome = { kind: "done" };
    } catch (error) {
      outcome = {
        kind: "failed",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    try {
      await store.settle(item.id, outcome);
    } catch (cause) {
      // The item stays at the head so nothing behind it overtakes it,
      // and the lane stops so it is not run again in this process.
      lane.halted = true;
      lane.running = false;
      const error = new InboxSettleError(
        item.id,
        item.conversationId,
        cause,
      );
      failures.push(error);
      if (onError !== undefined) {
        notify("onError", () => onError(error));
      }
      return;
    }
    lane.queue.shift();
    known.delete(item.id);
    lane.running = false;
    if (onSettle !== undefined) {
      notify("onSettle", () => onSettle(item, outcome));
    }
  };

  const pump = (): void => {
    cancelTimer?.();
    cancelTimer = undefined;
    if (!started || closed) {
      return;
    }
    const now = clock.now();
    let nextDue: number | undefined;
    for (const [conversationId, lane] of lanes) {
      if (lane.running || lane.halted) {
        continue;
      }
      const head = lane.queue[0];
      if (head === undefined) {
        lanes.delete(conversationId);
        continue;
      }
      if (head.dueAt <= now) {
        lane.running = true;
        const delivery = deliver(lane, head).finally(() => {
          inFlight.delete(delivery);
          pump();
        });
        inFlight.add(delivery);
      } else if (nextDue === undefined || head.dueAt < nextDue) {
        nextDue = head.dueAt;
      }
    }
    if (nextDue !== undefined) {
      cancelTimer = clock.setTimer(
        pump,
        Math.min(nextDue - now, MAX_TIMER_MS),
      );
    }
  };

  return {
    async start() {
      if (closed) {
        throw new InboxClosedError();
      }
      if (started) {
        return;
      }
      for (const item of await store.pending()) {
        enqueue(item);
      }
      started = true;
      pump();
    },

    async add(conversationId, input, addOptions) {
      if (closed) {
        throw new InboxClosedError();
      }
      assertJsonInput(input);
      const at = clock.now();
      const item = await store.add(
        { conversationId, input, dueAt: addOptions?.dueAt ?? at },
        at,
      );
      if (!closed) {
        enqueue(item);
        pump();
      }
      return item;
    },

    async close() {
      closed = true;
      cancelTimer?.();
      cancelTimer = undefined;
      await Promise.allSettled(inFlight);
      const first = failures[0];
      if (first !== undefined) {
        throw first;
      }
    },
  };
};
