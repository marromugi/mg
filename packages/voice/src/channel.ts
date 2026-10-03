// A queue between a producer and one consumer. The consumer reads what was
// pushed in order; end() finishes it and fail() makes it throw after
// everything pushed before. It stops without error once `signal` fires.
export type Channel<T> = {
  push(value: T): void;
  end(): void;
  fail(error: unknown): void;
  items: AsyncIterable<T>;
};

const nothing = (): void => {};

export const createChannel = <T>(signal: AbortSignal): Channel<T> => {
  const queue: T[] = [];
  let finished: { error?: unknown } | undefined;
  let wake = nothing;
  const notify = () => wake();
  signal.addEventListener("abort", notify, { once: true });
  return {
    push(value) {
      if (finished !== undefined) return;
      queue.push(value);
      notify();
    },
    end() {
      finished ??= {};
      notify();
    },
    fail(error) {
      finished ??= { error };
      notify();
    },
    items: (async function* () {
      try {
        while (!signal.aborted) {
          const next = queue.shift();
          if (next !== undefined) yield next;
          else if (finished !== undefined) {
            if ("error" in finished) throw finished.error;
            return;
          } else {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        }
      } finally {
        signal.removeEventListener("abort", notify);
      }
    })(),
  };
};
