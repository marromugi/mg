import type { AudioFormat } from "../audio.js";
import type { PlaybackEnd, Player } from "../player.js";

// A started process: its stdin, a promise of its exit code, and a way to
// end it. exit rejects when the process cannot run.
export interface SpawnedProcess {
  stdin: { write(data: Uint8Array): void; end(): void };
  exit: Promise<number>;
  kill(): void;
}
export type SpawnProcess = (
  command: string,
  args: string[],
) => SpawnedProcess;

const STOPPED = Symbol("stopped");

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

const noop = () => {};

type Exit = { code: number } | { error: unknown };

const never = new Promise<never>(noop);

const deferred = <T>(): Deferred<T> => {
  const holder: Deferred<T> = {
    promise: undefined as never,
    resolve: noop,
  };
  holder.promise = new Promise<T>((resolve) => {
    holder.resolve = resolve;
  });
  return holder;
};

type Round = {
  stopped: boolean;
  stopSignal: Promise<typeof STOPPED>;
  end(): void;
  current: SpawnedProcess | undefined;
  slots: Map<number, Deferred<void>>;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const commandFor = (format: AudioFormat): string[] => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "s16le",
  "-ar",
  String(format.sampleRate),
  "-ac",
  String(format.channels),
  "-i",
  "pipe:0",
  "-f",
  "audiotoolbox",
  "-",
];

const kill = (process: SpawnedProcess | undefined) => {
  try {
    process?.kill();
  } catch {
    // The process is already gone.
  }
};

const newRound = (): Round => {
  const { promise, resolve } = deferred<typeof STOPPED>();
  return {
    stopped: false,
    stopSignal: promise,
    end: () => resolve(STOPPED),
    current: undefined,
    slots: new Map(),
  };
};

const slotOf = (round: Round, index: number) => {
  let slot = round.slots.get(index);
  if (slot === undefined) {
    slot = deferred<void>();
    round.slots.set(index, slot);
  }
  return slot;
};

export const createFfmpegPlayer = ({
  spawn,
}: {
  spawn: SpawnProcess;
}): Player => {
  let round = newRound();

  const start = (r: Round, format: AudioFormat) => {
    let process: SpawnedProcess;
    try {
      process = spawn("ffmpeg", commandFor(format));
    } catch (error) {
      throw new Error(`ffmpeg could not start: ${messageOf(error)}`, {
        cause: error,
      });
    }
    r.current = process;
    const exited = process.exit.then(
      (code): Exit => ({ code }),
      (error: unknown): Exit => ({ error }),
    );
    return { process, exited };
  };

  const run = async (
    r: Round,
    audio: AsyncIterable<{ format: AudioFormat; data: Uint8Array }>,
  ): Promise<PlaybackEnd> => {
    const iterator = audio[Symbol.asyncIterator]();
    let started: ReturnType<typeof start> | undefined;
    const finish = (outcome: Exit): PlaybackEnd => {
      if ("error" in outcome) {
        throw new Error(
          `ffmpeg could not start: ${messageOf(outcome.error)}`,
        );
      }
      if (outcome.code !== 0) {
        throw new Error(`ffmpeg failed with exit code ${outcome.code}`);
      }
      return { played: true };
    };
    try {
      for (;;) {
        const step = await Promise.race([
          iterator.next(),
          r.stopSignal,
          started?.exited ?? never,
        ]);
        if (r.stopped || step === STOPPED) {
          kill(started?.process);
          return { played: false };
        }
        if ("code" in step || "error" in step) return finish(step);
        if (step.done) break;
        started ??= start(r, step.value.format);
        started.process.stdin.write(step.value.data);
      }
      if (started === undefined) return { played: true };
      started.process.stdin.end();
      const outcome = await Promise.race([
        started.exited,
        r.stopSignal,
      ]);
      if (outcome === STOPPED) {
        kill(started.process);
        return { played: false };
      }
      return finish(outcome);
    } catch (error) {
      kill(started?.process);
      throw error;
    } finally {
      await iterator.return?.().catch(() => undefined);
    }
  };

  return {
    async play(index, audio) {
      const r = round;
      try {
        if (index > 0) {
          await Promise.race([
            slotOf(r, index - 1).promise,
            r.stopSignal,
          ]);
        }
        if (r.stopped) return { played: false };
        return await run(r, audio);
      } finally {
        slotOf(r, index).resolve(undefined);
      }
    },
    stop() {
      const r = round;
      round = newRound();
      r.stopped = true;
      try {
        r.current?.kill();
      } catch {
        // Stopping never throws.
      }
      r.end();
    },
  };
};
