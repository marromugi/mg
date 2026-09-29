import type { AudioChunk } from "../audio.js";
import type { Clock } from "../clock.js";
import type { HeardUtterance, Listener } from "../listener.js";
import { chunkDurationMs } from "./wav.js";

export type RecordedUtterance = { at: number; audio: AudioChunk[] };

// Yields each utterance `at` ms after listening starts, in the order given.
// Its audio streams each chunk, then waits the chunk's real-time duration.
export function createRecordedListener({
  utterances,
  clock,
}: {
  utterances: RecordedUtterance[];
  clock: Clock;
}): Listener {
  return {
    async *listen(signal): AsyncIterable<HeardUtterance> {
      const start = clock.now();
      for (const utterance of utterances) {
        const wait = utterance.at - (clock.now() - start);
        if (wait > 0) await clock.sleep(wait, signal);
        yield { audio: stream(utterance.audio, clock, signal) };
      }
    },
  };
}

async function* stream(
  chunks: AudioChunk[],
  clock: Clock,
  signal: AbortSignal,
): AsyncIterable<AudioChunk> {
  for (const chunk of chunks) {
    yield chunk;
    await clock.sleep(chunkDurationMs(chunk), signal);
  }
}
