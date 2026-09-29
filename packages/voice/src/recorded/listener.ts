import type { AudioChunk } from "../audio.js";
import { sleepUnlessAborted } from "../clock.js";
import type { Clock } from "../clock.js";
import type { HeardUtterance, Listener } from "../listener.js";
import { chunkDurationMs } from "./wav.js";

export type RecordedUtterance = { at: number; audio: AudioChunk[] };

async function* stream(
  chunks: AudioChunk[],
  clock: Clock,
  signal: AbortSignal,
): AsyncIterable<AudioChunk> {
  const start = clock.now();
  let playedMs = 0;
  for (const chunk of chunks) {
    if (signal.aborted) return;
    yield chunk;
    playedMs += chunkDurationMs(chunk);
    const remaining = start + playedMs - clock.now();
    if (!(await sleepUnlessAborted(clock, remaining, signal))) return;
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
      if (
        remaining > 0 &&
        !(await sleepUnlessAborted(clock, remaining, signal))
      ) {
        return;
      }
      if (signal.aborted) return;
      yield { audio: stream(utterance.audio, clock, signal) };
    }
  },
});
