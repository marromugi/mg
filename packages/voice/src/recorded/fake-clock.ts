import type { Clock } from "../clock.js";

type Sleeper = { due: number; resolve: () => void };

export type FakeClock = Clock & {
  // Moves time forward. The first sleeper due is woken before the first
  // await, so a caller can act at that instant before anything resumes.
  advance(ms: number): Promise<void>;
};

const flush = () => new Promise<void>((r) => setImmediate(r));

export function createFakeClock(): FakeClock {
  let time = 0;
  const sleepers: Sleeper[] = [];
  return {
    now: () => time,
    sleep(ms, signal) {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new Error("aborted"));
        const sleeper = { due: time + ms, resolve };
        sleepers.push(sleeper);
        signal?.addEventListener("abort", () => {
          const at = sleepers.indexOf(sleeper);
          if (at >= 0) sleepers.splice(at, 1);
          reject(new Error("aborted"));
        });
      });
    },
    async advance(ms) {
      const target = time + ms;
      for (;;) {
        const next = sleepers
          .filter((s) => s.due <= target)
          .sort((a, b) => a.due - b.due)[0];
        if (!next) break;
        sleepers.splice(sleepers.indexOf(next), 1);
        time = Math.max(time, next.due);
        next.resolve();
        await flush();
      }
      time = target;
      await flush();
    },
  };
}
