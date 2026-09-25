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

type Running = {
  // Set only once the run function is about to be called, so wrapUp()
  // reports nothing running while onStart is still in progress.
  controller?: AbortController;
  done: Promise<void>;
};

export const createRunQueue = <TInput, TOutcome>(
  run: QueueRun<TInput, TOutcome>,
  options?: QueueOptions,
): RunQueue<TInput, TOutcome> => {
  const waiting: WaitingItem<TInput, TOutcome>[] = [];
  let closed = false;
  let current: Running | undefined;

  const dropWaiting = (): void => {
    while (waiting.length > 0) {
      const item = waiting.shift();
      if (item === undefined) break;
      item.settle({ kind: "dropped", reason: "closed" });
    }
  };

  const runOne = async (
    item: WaitingItem<TInput, TOutcome>,
    running: Running,
  ): Promise<void> => {
    try {
      options?.onStart?.(item.id);
    } catch (error) {
      item.settle({ kind: "failed", error });
      return;
    }

    const controller = new AbortController();
    running.controller = controller;

    let ended = false;
    let ending: QueueEnding<TOutcome>;
    try {
      const outcome = await run(item.input, {
        sessionId: item.id,
        wrapUp: controller.signal,
        onEvent: (event) => {
          if (ended) return;
          options?.onEvent?.(item.id, event);
        },
      });
      ending = { kind: "finished", outcome };
    } catch (error) {
      ending = { kind: "failed", error };
    }
    ended = true;

    item.settle(ending);
  };

  const pump = (): void => {
    if (current !== undefined) return;
    const item = waiting.shift();
    if (item === undefined) return;

    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const running: Running = { done };
    current = running;

    void runOne(item, running).finally(() => {
      current = undefined;
      resolveDone();
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
    if (current?.controller === undefined) return false;
    current.controller.abort();
    return true;
  };

  const close = async (): Promise<void> => {
    closed = true;
    dropWaiting();
    await current?.done;
  };

  return { enqueue, wrapUp, close };
};
