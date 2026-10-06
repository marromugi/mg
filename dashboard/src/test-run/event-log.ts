// Keeps every event of one run, in order. Each watcher reads from the
// first event, whether it arrives before or after the event was added.
export type EventLog<T> = {
  push(event: T): void;
  close(): void;
  watch(): AsyncIterable<T>;
};

export const createEventLog = <T>(): EventLog<T> => {
  const events: T[] = [];
  const waiting = new Set<() => void>();
  let closed = false;

  const wake = (): void => {
    for (const resume of waiting) resume();
    waiting.clear();
  };

  return {
    push: (event) => {
      events.push(event);
      wake();
    },
    close: () => {
      closed = true;
      wake();
    },
    watch: async function* () {
      let next = 0;
      for (;;) {
        if (next < events.length) {
          next += 1;
          yield events[next - 1];
        } else if (closed) {
          return;
        } else {
          await new Promise<void>((resume) => waiting.add(resume));
        }
      }
    },
  };
};
