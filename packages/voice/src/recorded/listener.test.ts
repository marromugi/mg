import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { AudioChunk } from "../audio.js";
import type { Clock } from "../clock.js";
import { createRecordedListener } from "./listener.js";

const clock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      });
    }),
};

const chunk100ms: AudioChunk = {
  format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 },
  data: new Uint8Array(3200),
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("recorded listener", () => {
  test("yields each utterance at its start time and ends its audio after the chunk's duration", async () => {
    const listener = createRecordedListener({
      utterances: [
        { at: 0, audio: [chunk100ms] },
        { at: 500, audio: [chunk100ms] },
      ],
      clock,
    });
    const started = Date.now();
    const yieldedAt: number[] = [];
    const audioEndedAt: number[] = [];
    const chunksSeen: number[] = [];
    const audioReads: Promise<void>[] = [];
    const run = (async () => {
      for await (const utterance of listener.listen(
        new AbortController().signal,
      )) {
        yieldedAt.push(Date.now() - started);
        audioReads.push(
          (async () => {
            let count = 0;
            for await (const _ of utterance.audio) count += 1;
            chunksSeen.push(count);
            audioEndedAt.push(Date.now() - started);
          })(),
        );
      }
    })();
    await vi.advanceTimersByTimeAsync(0);
    expect(yieldedAt).toEqual([0]);
    await vi.advanceTimersByTimeAsync(99);
    expect(audioEndedAt).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(audioEndedAt).toEqual([100]);
    await vi.advanceTimersByTimeAsync(399);
    expect(yieldedAt).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(yieldedAt).toEqual([0, 500]);
    await vi.advanceTimersByTimeAsync(100);
    await run;
    await Promise.all(audioReads);
    expect(chunksSeen).toEqual([1, 1]);
    expect(audioEndedAt).toEqual([100, 600]);
  });
});
