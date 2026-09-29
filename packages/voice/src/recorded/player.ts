import type { AudioChunk, AudioFormat } from "../audio.js";
import type { Clock } from "../clock.js";
import type { PlaybackEnd, Player } from "../player.js";
import { chunkDurationMs, encodeWav } from "./wav.js";

type Deferred = { promise: Promise<void>; resolve: () => void };

const noop = () => {};

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

// The sentences of one text: its number, the last accepted index, the
// end of the last accepted sentence, and how many have not ended.
type Text = {
  number: number;
  lastIndex: number;
  tail: Promise<void>;
  pending: number;
};

// Everything a stop cuts off.
type Round = {
  text: Text | undefined;
  abort: AbortController;
};

const newRound = (): Round => ({
  text: undefined,
  abort: new AbortController(),
});

const describeFormat = (format: AudioFormat): string =>
  `${format.sampleRate} Hz, ${format.channels} channel${format.channels === 1 ? "" : "s"}`;

const STOPPED = Symbol("stopped");

// Settles with the promise, or with STOPPED when the signal fires first.
const raceStop = async <T>(
  signal: AbortSignal,
  promise: Promise<T>,
): Promise<T | typeof STOPPED> => {
  if (signal.aborted) return STOPPED;
  let onAbort: () => void = noop;
  const stop = new Promise<typeof STOPPED>((resolve) => {
    onAbort = () => resolve(STOPPED);
    signal.addEventListener("abort", onAbort);
  });
  try {
    return await Promise.race([promise, stop]);
  } finally {
    signal.removeEventListener("abort", onAbort);
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

// Sleeps the duration; false when the signal fired first.
const play = async (
  clock: Clock,
  ms: number,
  signal: AbortSignal,
): Promise<boolean> => {
  try {
    await clock.sleep(ms, signal);
  } catch (error) {
    if (signal.aborted) return false;
    throw error;
  }
  return !signal.aborted;
};

export const createRecordingPlayer = ({
  write,
  clock,
}: {
  write: (name: string, bytes: Uint8Array) => Promise<void>;
  clock: Clock;
}): Player => {
  let round = newRound();
  let nextTextNumber = 0;

  // Accepts the index into the round's text, or throws the rule it breaks.
  const admit = (index: number): Text => {
    if (index === 0) {
      if (round.text !== undefined && round.text.pending > 0) {
        throw new Error(
          "index 0 came while a sentence of an earlier text is playing or waiting",
        );
      }
      round.text = {
        number: nextTextNumber,
        lastIndex: 0,
        tail: Promise.resolve(),
        pending: 0,
      };
      nextTextNumber += 1;
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

  // Takes the chunks, each after its real-time duration, and writes what
  // was taken when the audio ends, is stopped, or is rejected.
  const run = async (
    signal: AbortSignal,
    name: string,
    audio: AsyncIterable<AudioChunk>,
  ): Promise<PlaybackEnd> => {
    const iterator = audio[Symbol.asyncIterator]();
    const taken: Uint8Array[] = [];
    let format: AudioFormat | undefined;
    let played = true;
    let failure: { error: unknown } | undefined;
    try {
      for (;;) {
        const step = await raceStop(signal, iterator.next());
        if (step === STOPPED) {
          played = false;
          break;
        }
        if (step.done) break;
        const next = step.value;
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
        if (!(await play(clock, chunkDurationMs(next), signal))) {
          played = false;
          break;
        }
        taken.push(next.data);
      }
    } catch (error) {
      failure = { error };
    } finally {
      release(iterator);
    }
    if (format !== undefined && taken.length > 0) {
      await write(name, encodeWav(format, taken));
    }
    if (failure !== undefined) throw failure.error;
    return { played };
  };

  return {
    async play(index, audio) {
      const r = round;
      const text = admit(index);
      const name = `${text.number}-${index}.wav`;
      const previous = text.tail;
      const ended = deferred();
      text.tail = ended.promise;
      text.pending += 1;
      try {
        if ((await raceStop(r.abort.signal, previous)) === STOPPED) {
          return { played: false };
        }
        return await run(r.abort.signal, name, audio);
      } finally {
        text.pending -= 1;
        ended.resolve();
      }
    },
    stop() {
      const r = round;
      round = newRound();
      r.abort.abort();
    },
  };
};
