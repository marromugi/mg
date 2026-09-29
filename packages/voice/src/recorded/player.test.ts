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
import { createRecordingPlayer } from "./player.js";

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

const setup = () => {
  const files: { name: string; bytes: Uint8Array }[] = [];
  const player = createRecordingPlayer({
    write: async (name, bytes) => {
      files.push({ name, bytes });
    },
    clock,
  });
  return { files, player };
};

const chunk = (
  bytes: number,
  sampleRate = 24000,
  channels = 1,
): AudioChunk => ({
  format: { encoding: "pcm-s16le", sampleRate, channels },
  data: new Uint8Array(bytes),
});

async function* audioOf(
  ...chunks: AudioChunk[]
): AsyncIterable<AudioChunk> {
  for (const c of chunks) yield c;
}

const WAV_HEADER_BYTES = 44;
const dataBytes = (file: { bytes: Uint8Array }) =>
  file.bytes.length - WAV_HEADER_BYTES;
const tag = (file: { bytes: Uint8Array }) =>
  String.fromCharCode(...file.bytes.slice(0, 4));
const names = (files: { name: string }[]) => files.map((f) => f.name);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("recording player", () => {
  test("writes 0-0.wav with 4800 data bytes and resolves played true at 100 ms, not before", async () => {
    const { files, player } = setup();
    let end: unknown;
    void player.play(0, audioOf(chunk(4800))).then((e) => {
      end = e;
    });
    await vi.advanceTimersByTimeAsync(99);
    expect(end).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(end).toEqual({ played: true });
    expect(names(files)).toEqual(["0-0.wav"]);
    expect(tag(files[0])).toBe("RIFF");
    expect(dataBytes(files[0])).toBe(4800);
  });

  test("names files by text number and sentence index", async () => {
    const { files, player } = setup();
    const play = async (index: number) => {
      const done = player.play(index, audioOf(chunk(4800)));
      await vi.advanceTimersByTimeAsync(100);
      await done;
    };
    await play(0);
    await play(1);
    await play(0);
    expect(names(files)).toEqual(["0-0.wav", "0-1.wav", "1-0.wav"]);
  });

  test("rejects index 1 with no text and index 0 during a playing sentence, writing only the played file", async () => {
    const { files, player } = setup();
    await expect(player.play(1, audioOf(chunk(4800)))).rejects.toThrow(
      /no text/,
    );
    expect(files).toEqual([]);
    const first = player.play(0, audioOf(chunk(4800)));
    await expect(player.play(0, audioOf(chunk(4800)))).rejects.toThrow(
      /index 0/,
    );
    await vi.advanceTimersByTimeAsync(100);
    await first;
    expect(names(files)).toEqual(["0-0.wav"]);
    const next = player.play(0, audioOf(chunk(4800)));
    await vi.advanceTimersByTimeAsync(100);
    await next;
    expect(names(files)).toEqual(["0-0.wav", "1-0.wav"]);
  });

  test("rejects a chunk in another format naming both formats, and the file holds the earlier chunk", async () => {
    const { files, player } = setup();
    const done = player.play(
      0,
      audioOf(chunk(4800, 24000, 1), chunk(3200, 16000, 1)),
    );
    const outcome = done.then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(String(await outcome)).toMatch(/24000.*16000/);
    expect(names(files)).toEqual(["0-0.wav"]);
    expect(dataBytes(files[0])).toBe(4800);
  });

  test("stopping at 200 ms resolves the running and the waiting play as not played and keeps the audio written so far", async () => {
    const { files, player } = setup();
    const first = player.play(
      0,
      audioOf(...Array.from({ length: 10 }, () => chunk(4800))),
    );
    const second = player.play(1, audioOf(chunk(4800)));
    await vi.advanceTimersByTimeAsync(200);
    player.stop();
    await expect(first).resolves.toEqual({ played: false });
    await expect(second).resolves.toEqual({ played: false });
    expect(names(files)).toEqual(["0-0.wav"]);
    expect(dataBytes(files[0])).toBe(9600);
  });
});
