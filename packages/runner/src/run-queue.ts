import type { HarnessEvent } from "@mg/harness";
import { nanoid } from "nanoid";

export type QueueRunOptions = {
  sessionId: string;
  wrapUp: AbortSignal;
  onEvent: (event: HarnessEvent) => void;
};

export type QueueRun<TInput, TOutcome> = (
  input: TInput,
  options: QueueRunOptions,
) => Promise<TOutcome>;

export type QueueEnding<TOutcome> =
  | { kind: "finished"; outcome: TOutcome }
  | { kind: "failed"; error: unknown }
  | { kind: "dropped"; reason: "closed" };

export type QueueOptions = {
  onStart?: (id: string) => void;
  onEvent?: (id: string, event: HarnessEvent) => void;
};

export type RunQueue<TInput, TOutcome> = {
  enqueue(
    input: TInput,
    options?: { first?: boolean },
  ): { id: string; ending: Promise<QueueEnding<TOutcome>> };
  wrapUp(): boolean;
  close(): Promise<void>;
};

type WaitingItem<TInput, TOutcome> = {
  id: string;
  input: TInput;
  settle: (ending: QueueEnding<TOutcome>) => void;
};

export const createRunQueue = <TInput, TOutcome>(
  run: QueueRun<TInput, TOutcome>,
  options?: QueueOptions,
): RunQueue<TInput, TOutcome> => {
  const waiting: WaitingItem<TInput, TOutcome>[] = [];
  let closed = false;
  let scheduled = false;
  let active: AbortController | undefined;
  let idle: Promise<void> = Promise.resolve();

  const dropWaiting = (): void => {
    while (waiting.length > 0) {
      const item = waiting.shift();
      if (item === undefined) break;
      item.settle({ kind: "dropped", reason: "closed" });
    }
  };

  const runOne = async (
    item: WaitingItem<TInput, TOutcome>,
  ): Promise<void> => {
    const controller = new AbortController();
    active = controller;

    try {
      options?.onStart?.(item.id);
    } catch (error) {
      active = undefined;
      item.settle({ kind: "failed", error });
      return;
    }

    let ending: QueueEnding<TOutcome>;
    try {
      const outcome = await run(item.input, {
        sessionId: item.id,
        wrapUp: controller.signal,
        onEvent: (event) => {
          options?.onEvent?.(item.id, event);
        },
      });
      ending = { kind: "finished", outcome };
    } catch (error) {
      ending = { kind: "failed", error };
    }

    active = undefined;
    item.settle(ending);
  };

  const pump = (): void => {
    if (closed) {
      dropWaiting();
      return;
    }
    if (scheduled) return;
    const item = waiting.shift();
    if (item === undefined) return;
    scheduled = true;
    idle = runOne(item).finally(() => {
      scheduled = false;
      pump();
    });
  };

  const enqueue = (
    input: TInput,
    enqueueOptions?: { first?: boolean },
  ): { id: string; ending: Promise<QueueEnding<TOutcome>> } => {
    const id = nanoid();

    if (closed) {
      return {
        id,
        ending: Promise.resolve({ kind: "dropped", reason: "closed" }),
      };
    }

    let settle!: (ending: QueueEnding<TOutcome>) => void;
    const ending = new Promise<QueueEnding<TOutcome>>((resolve) => {
      settle = resolve;
    });

    const item: WaitingItem<TInput, TOutcome> = { id, input, settle };
    if (enqueueOptions?.first) waiting.unshift(item);
    else waiting.push(item);

    pump();

    return { id, ending };
  };

  const wrapUp = (): boolean => {
    if (active === undefined) return false;
    active.abort();
    return true;
  };

  const close = async (): Promise<void> => {
    closed = true;
    dropWaiting();
    await idle;
  };

  return { enqueue, wrapUp, close };
};
