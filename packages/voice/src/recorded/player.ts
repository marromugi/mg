import type { AudioChunk } from "../audio.js";
import type { Clock } from "../clock.js";
import type { PlaybackEnd, Player } from "../player.js";
import { chunkDurationMs, encodeWav } from "./wav.js";

// Plays sentences one after another. Each sentence is taken chunk by chunk,
// waiting each chunk's real-time duration, then written as `<index>.wav`.
// A failed write rejects that play with the writer's error.
export function createRecordingPlayer({
  write,
  clock,
}: {
  write: (name: string, bytes: Uint8Array) => Promise<void>;
  clock: Clock;
}): Player {
  let tail: Promise<unknown> = Promise.resolve();
  let generation = 0;
  let current: AbortController | undefined;

  async function playOne(
    index: number,
    audio: AsyncIterable<AudioChunk>,
    queuedIn: number,
  ): Promise<PlaybackEnd> {
    if (queuedIn !== generation) return { played: false };
    const controller = new AbortController();
    current = controller;
    const taken: AudioChunk[] = [];
    let stopped = false;
    try {
      for await (const chunk of audio) {
        if (controller.signal.aborted) {
          stopped = true;
          break;
        }
        taken.push(chunk);
        try {
          await clock.sleep(chunkDurationMs(chunk), controller.signal);
        } catch (error) {
          if (!controller.signal.aborted) throw error;
        }
        if (controller.signal.aborted) {
          stopped = true;
          break;
        }
      }
    } finally {
      if (current === controller) current = undefined;
    }
    const first = taken[0];
    if (first) {
      const data = new Uint8Array(
        taken.reduce((sum, c) => sum + c.data.length, 0),
      );
      let at = 0;
      for (const c of taken) {
        data.set(c.data, at);
        at += c.data.length;
      }
      await write(`${index}.wav`, encodeWav(first.format, data));
    }
    return { played: !stopped };
  }

  return {
    play(index, audio) {
      const queuedIn = generation;
      const run = tail.then(() => playOne(index, audio, queuedIn));
      tail = run.catch(() => {});
      return run;
    },
    stop() {
      generation += 1;
      current?.abort();
    },
  };
}
