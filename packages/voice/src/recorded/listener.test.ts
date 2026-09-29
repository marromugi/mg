import { describe, expect, test } from "vitest";
import type { AudioChunk } from "../audio.js";
import { createFakeClock } from "./fake-clock.js";
import { createRecordedListener } from "./listener.js";

const chunk: AudioChunk = {
  format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 },
  data: new Uint8Array(3200),
};

describe("createRecordedListener", () => {
  test("yields each utterance at its start time and ends its audio after the chunk's real-time duration", async () => {
    const clock = createFakeClock();
    const listener = createRecordedListener({
      utterances: [
        { at: 0, audio: [chunk] },
        { at: 500, audio: [chunk] },
      ],
      clock,
    });
    const yielded: number[] = [];
    let audioEnd: number | undefined;
    const done = (async () => {
      for await (const utterance of listener.listen(
        new AbortController().signal,
      )) {
        yielded.push(clock.now());
        if (yielded.length === 1) {
          void (async () => {
            for await (const _ of utterance.audio) {
              // drain
            }
            audioEnd = clock.now();
          })();
        }
      }
    })();

    await clock.advance(0);
    expect(yielded).toEqual([0]);
    await clock.advance(99);
    expect(audioEnd).toBeUndefined();
    await clock.advance(1);
    expect(audioEnd).toBe(100);
    await clock.advance(399);
    expect(yielded).toEqual([0]);
    await clock.advance(1);
    expect(yielded).toEqual([0, 500]);
    await done;
  });
});
