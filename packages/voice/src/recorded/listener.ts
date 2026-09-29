import type { AudioChunk } from "../audio.js";
import type { Clock } from "../clock.js";
import type { HeardUtterance, Listener } from "../listener.js";
import { chunkDurationMs } from "./wav.js";

export type RecordedUtterance = { at: number; audio: AudioChunk[] };

// Sleeps; false when the signal fired first.
const wait = async (
  clock: Clock,
  ms: number,
  signal: AbortSignal,
): Promise<boolean> => {
  if (signal.aborted) return false;
  try {
    await clock.sleep(ms, signal);
  } catch (error) {
    if (signal.aborted) return false;
    throw error;
  }
  return !signal.aborted;
};

async function* stream(
  chunks: AudioChunk[],
  clock: Clock,
  signal: AbortSignal,
): AsyncIterable<AudioChunk> {
  for (const chunk of chunks) {
    if (signal.aborted) return;
    yield chunk;
    if (!(await wait(clock, chunkDurationMs(chunk), signal))) return;
  }
}

// Yields each utterance `at` ms after listening starts, in the order
// given. Its audio yields each chunk, then waits the chunk's duration.
export const createRecordedListener = ({
  utterances,
  clock,
}: {
  utterances: RecordedUtterance[];
  clock: Clock;
}): Listener => ({
  async *listen(signal): AsyncIterable<HeardUtterance> {
    const start = clock.now();
    for (const utterance of utterances) {
      const remaining = utterance.at - (clock.now() - start);
      if (remaining > 0 && !(await wait(clock, remaining, signal))) {
        return;
      }
      if (signal.aborted) return;
      yield { audio: stream(utterance.audio, clock, signal) };
    }
  },
});
