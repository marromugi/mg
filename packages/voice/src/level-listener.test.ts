import { describe, expect, test } from "vitest";
import type { AudioChunk, AudioFormat } from "./audio.js";
import { createLevelListener } from "./level-listener.js";
import type { Microphone } from "./microphone.js";

const format: AudioFormat = {
  encoding: "pcm-s16le",
  sampleRate: 1000,
  channels: 1,
};

// At 1000 Hz one sample is 1 ms, so a 20 ms window is 20 samples.
// A constant 3277 is about -20 dB and a constant 33 about -60 dB.
const LOUD = 3277;
const QUIET = 33;

const tone = (ms: number, value: number): number[] =>
  Array.from({ length: ms }, () => value);

const chunkOf = (samples: number[]): AudioChunk => {
  const data = new Uint8Array(samples.length * 2);
  const view = new DataView(data.buffer);
  samples.forEach((sample, at) => view.setInt16(at * 2, sample, true));
  return { format, data };
};

const samplesOf = (chunks: AudioChunk[]): number[] =>
  chunks.flatMap((chunk) => {
    const view = new DataView(
      chunk.data.buffer,
      chunk.data.byteOffset,
      chunk.data.length,
    );
    return Array.from({ length: chunk.data.length / 2 }, (_, at) =>
      view.getInt16(at * 2, true),
    );
  });

// Hands out the samples in chunks of `chunkMs`, then ends.
const microphoneOf = (
  samples: number[],
  chunkMs: number,
): Microphone => ({
  async *open() {
    for (let at = 0; at < samples.length; at += chunkMs) {
      yield chunkOf(samples.slice(at, at + chunkMs));
    }
  },
});

const listenerOn = (microphone: Microphone, levelDb = -40) =>
  createLevelListener({
    microphone,
    levelDb,
    startMs: 100,
    endMs: 800,
    leadMs: 300,
  });

const heard = async (
  microphone: Microphone,
  levelDb = -40,
): Promise<number[][]> => {
  const utterances: number[][] = [];
  for await (const utterance of listenerOn(microphone, levelDb).listen(
    new AbortController().signal,
  )) {
    const chunks: AudioChunk[] = [];
    for await (const chunk of utterance.audio) chunks.push(chunk);
    utterances.push(samplesOf(chunks));
  }
  return utterances;
};

describe("level listener", () => {
  test("cuts a loud stretch with 300 ms before it and the 800 ms of quiet after it", async () => {
    const samples = [
      ...tone(1000, QUIET),
      ...tone(200, LOUD),
      ...tone(1000, QUIET),
    ];
    expect(await heard(microphoneOf(samples, 10))).toEqual([
      [...tone(300, QUIET), ...tone(200, LOUD), ...tone(800, QUIET)],
    ]);
  });

  test("gives the same utterance whatever the size of the microphone's chunks", async () => {
    const samples = [
      ...tone(1000, QUIET),
      ...tone(200, LOUD),
      ...tone(1000, QUIET),
    ];
    expect(await heard(microphoneOf(samples, 7))).toEqual([
      [...tone(300, QUIET), ...tone(200, LOUD), ...tone(800, QUIET)],
    ]);
  });

  test("gives no utterance for a loud stretch shorter than 100 ms", async () => {
    const samples = [
      ...tone(500, QUIET),
      ...tone(80, LOUD),
      ...tone(1000, QUIET),
    ];
    expect(await heard(microphoneOf(samples, 10))).toEqual([]);
  });

  test("keeps a pause shorter than 800 ms inside one utterance", async () => {
    const samples = [
      ...tone(500, QUIET),
      ...tone(200, LOUD),
      ...tone(400, QUIET),
      ...tone(200, LOUD),
      ...tone(1000, QUIET),
    ];
    const utterances = await heard(microphoneOf(samples, 10));
    expect(utterances.map((audio) => audio.length)).toEqual([1900]);
  });

  test("splits two utterances at a pause of 800 ms or more", async () => {
    const samples = [
      ...tone(500, QUIET),
      ...tone(200, LOUD),
      ...tone(900, QUIET),
      ...tone(200, LOUD),
      ...tone(1000, QUIET),
    ];
    const utterances = await heard(microphoneOf(samples, 10));
    expect(utterances.map((audio) => audio.length)).toEqual([
      1300, 1100,
    ]);
  });

  test("gives no utterance at a level above everything heard", async () => {
    const samples = [...tone(500, QUIET), ...tone(200, LOUD)];
    expect(await heard(microphoneOf(samples, 10), 0)).toEqual([]);
  });

  test("ends an utterance still open when the microphone ends", async () => {
    const samples = [...tone(500, QUIET), ...tone(200, LOUD)];
    expect(await heard(microphoneOf(samples, 10))).toEqual([
      [...tone(300, QUIET), ...tone(200, LOUD)],
    ]);
  });

  test("throws what the microphone throws", async () => {
    const microphone: Microphone = {
      // oxlint-disable-next-line require-yield
      async *open() {
        throw new Error("ffmpeg failed with exit code 1");
      },
    };
    await expect(heard(microphone)).rejects.toThrow(
      "ffmpeg failed with exit code 1",
    );
  });

  test("ends without error once the signal has fired", async () => {
    const controller = new AbortController();
    const microphone: Microphone = {
      async *open(signal) {
        yield chunkOf(tone(500, QUIET));
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve());
        });
      },
    };
    const done = (async () => {
      for await (const utterance of listenerOn(microphone).listen(
        controller.signal,
      )) {
        void utterance;
      }
    })();
    controller.abort();
    await expect(done).resolves.toBeUndefined();
  });
});
