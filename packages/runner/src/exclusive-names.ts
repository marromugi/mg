export type ExclusiveNames = {
  acquire(
    names: readonly string[],
    signal?: AbortSignal,
  ): Promise<() => void>;
};

type Waiter = { resolve: () => void };

type NameLock = { locked: boolean; queue: Waiter[] };

const acquireLock = (
  lock: NameLock,
  signal: AbortSignal | undefined,
): Promise<void> => {
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise<void>((resolvePromise, rejectPromise) => {
    const waiter: Waiter = {
      resolve: () => {
        signal?.removeEventListener("abort", onAbort);
        resolvePromise();
      },
    };

    const onAbort = (): void => {
      const index = lock.queue.indexOf(waiter);
      if (index === -1) return;
      lock.queue.splice(index, 1);
      rejectPromise(signal?.reason);
    };

    if (!lock.locked) {
      lock.locked = true;
      waiter.resolve();
      return;
    }

    lock.queue.push(waiter);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

const releaseLock = (lock: NameLock): void => {
  const next = lock.queue.shift();
  if (next) {
    next.resolve();
    return;
  }
  lock.locked = false;
};

export const createExclusiveNames = (): ExclusiveNames => {
  const locks = new Map<string, NameLock>();

  const lockFor = (name: string): NameLock => {
    const existing = locks.get(name);
    if (existing) return existing;
    const created: NameLock = { locked: false, queue: [] };
    locks.set(name, created);
    return created;
  };

  const acquire = async (
    names: readonly string[],
    signal?: AbortSignal,
  ): Promise<() => void> => {
    const ordered = [...new Set(names)].sort();
    const held: string[] = [];

    try {
      for (const name of ordered) {
        await acquireLock(lockFor(name), signal);
        held.push(name);
      }
    } catch (error) {
      for (const name of held) {
        releaseLock(lockFor(name));
      }
      throw error;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const name of held) {
        releaseLock(lockFor(name));
      }
    };
  };

  return { acquire };
};
