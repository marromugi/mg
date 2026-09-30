import type { AudioChunk, AudioFormat } from "../audio.js";
import type { PlaybackEnd, Player } from "../player.js";
import type {
  ProcessExit,
  SpawnedProcess,
  SpawnProcess,
} from "./process.js";

type Deferred = { promise: Promise<void>; resolve: () => void };

const noop = () => {};

const ENCODING = "pcm-s16le";

const deferred = (): Deferred => {
  const holder: Deferred = {
    promise: undefined as never,
    resolve: noop,
  };
  holder.promise = new Promise<void>((resolve) => {
    holder.resolve = resolve;
  });
  return holder;
};

// The sentences of one text: the last accepted index, the end of the
// last accepted sentence, and how many have not ended.
type Text = { lastIndex: number; tail: Promise<void>; pending: number };

// Everything a stop cuts off.
type Round = {
  text: Text | undefined;
  stopped: boolean;
  listeners: Set<() => void>;
  current: SpawnedProcess | undefined;
};

type Exit = ProcessExit | { error: unknown };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const argsFor = (format: AudioFormat): string[] => [
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

const describeFormat = (format: AudioFormat): string =>
  `${format.sampleRate} Hz, ${format.channels} channel${format.channels === 1 ? "" : "s"}`;

const kill = (process: SpawnedProcess | undefined) => {
  try {
    process?.kill();
  } catch {
    // The process is already gone.
  }
};

const newRound = (): Round => ({
  text: undefined,
  stopped: false,
  listeners: new Set(),
  current: undefined,
});

const STOPPED = Symbol("stopped");

// Settles with the promise, or with STOPPED when the round is stopped
// first. The stop listener is removed once the race is decided.
const raceStop = async <T>(
  r: Round,
  promise: Promise<T>,
): Promise<T | typeof STOPPED> => {
  if (r.stopped) return STOPPED;
  let listener: () => void = noop;
  const stop = new Promise<typeof STOPPED>((resolve) => {
    listener = () => resolve(STOPPED);
    r.listeners.add(listener);
  });
  try {
    return await Promise.race([promise, stop]);
  } finally {
    r.listeners.delete(listener);
  }
};

// Ends the iterator without waiting for a pending next().
const release = (iterator: AsyncIterator<AudioChunk>) => {
  try {
    void Promise.resolve(iterator.return?.()).catch(noop);
  } catch {
    // The source is already finished.
  }
};

// Accepts the index into the round's text, or throws the rule it breaks.
const admit = (round: Round, index: number): Text => {
  if (index === 0) {
    if (round.text !== undefined && round.text.pending > 0) {
      throw new Error(
        "index 0 came while a sentence of an earlier text is playing or waiting",
      );
    }
    round.text = {
      lastIndex: 0,
      tail: Promise.resolve(),
      pending: 0,
    };
    return round.text;
  }
  const text = round.text;
  if (text === undefined) {
    throw new Error(`index ${index} came with no text begun`);
  }
  if (index <= text.lastIndex) {
    throw new Error(`index ${index} is a repeat of an earlier index`);
  }
  if (index > text.lastIndex + 1) {
    throw new Error(
      `index ${index} would skip index ${text.lastIndex + 1}`,
    );
  }
  text.lastIndex = index;
  return text;
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
      process = spawn("ffmpeg", argsFor(format));
    } catch (error) {
      throw new Error(`ffmpeg could not start: ${messageOf(error)}`, {
        cause: error,
      });
    }
    r.current = process;
    const exited = process.exit.then(
      (exit): Exit => exit,
      (error: unknown): Exit => ({ error }),
    );
    return { process, exited };
  };

  const finish = (outcome: Exit): PlaybackEnd => {
    if ("error" in outcome) {
      throw new Error(
        `ffmpeg could not start: ${messageOf(outcome.error)}`,
        { cause: outcome.error },
      );
    }
    if ("signal" in outcome) {
      throw new Error(`ffmpeg was ended by ${outcome.signal}`);
    }
    if (outcome.code !== 0) {
      throw new Error(`ffmpeg failed with exit code ${outcome.code}`);
    }
    return { played: true };
  };

  const run = async (
    r: Round,
    audio: AsyncIterable<AudioChunk>,
  ): Promise<PlaybackEnd> => {
    const iterator = audio[Symbol.asyncIterator]();
    let started: ReturnType<typeof start> | undefined;
    let format: AudioFormat | undefined;
    try {
      for (;;) {
        const step = await raceStop(
          r,
          Promise.race([
            iterator.next(),
            ...(started === undefined ? [] : [started.exited]),
          ]),
        );
        if (r.stopped || step === STOPPED) {
          kill(started?.process);
          return { played: false };
        }
        if ("code" in step || "signal" in step || "error" in step) {
          finish(step);
          throw new Error(
            "ffmpeg ended before all the audio was written",
          );
        }
        if (step.done) break;
        const next = step.value;
        const encoding: string = next.format.encoding;
        if (encoding !== ENCODING) {
          throw new Error(
            `ffmpeg cannot play encoding ${encoding}; it plays ${ENCODING}`,
          );
        }
        if (format === undefined) {
          format = next.format;
        } else if (
          next.format.sampleRate !== format.sampleRate ||
          next.format.channels !== format.channels
        ) {
          throw new Error(
            `chunk format changed from ${describeFormat(format)} to ${describeFormat(next.format)}`,
          );
        }
        started ??= start(r, format);
        started.process.stdin.write(next.data);
      }
      if (started === undefined) return { played: true };
      started.process.stdin.end();
      const outcome = await raceStop(r, started.exited);
      if (r.stopped || outcome === STOPPED) {
        kill(started.process);
        return { played: false };
      }
      return finish(outcome);
    } catch (error) {
      kill(started?.process);
      throw error;
    } finally {
      release(iterator);
    }
  };

  return {
    async play(index, audio) {
      const r = round;
      const text = admit(r, index);
      const previous = text.tail;
      const ended = deferred();
      text.tail = ended.promise;
      text.pending += 1;
      try {
        await raceStop(r, previous);
        if (r.stopped) return { played: false };
        return await run(r, audio);
      } finally {
        text.pending -= 1;
        ended.resolve();
      }
    },
    stop() {
      const r = round;
      round = newRound();
      r.stopped = true;
      kill(r.current);
      for (const listener of r.listeners) listener();
    },
  };
};
