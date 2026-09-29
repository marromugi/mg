import { describe, expect, test } from "vitest";
import type { AudioChunk } from "../audio.js";
import { createFakeClock } from "./fake-clock.js";
import { createRecordingPlayer } from "./player.js";

const format = {
  encoding: "pcm-s16le",
  sampleRate: 24000,
  channels: 1,
} as const;
const chunk = (): AudioChunk => ({
  format,
  data: new Uint8Array(4800),
});

async function* chunks(count: number) {
  for (let i = 0; i < count; i += 1) yield chunk();
}

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.slice(from, to));
const dataBytes = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return {
    header: ascii(bytes, 36, 40),
    size: view.getUint32(40, true),
  };
};

describe("createRecordingPlayer", () => {
  test("writes a sentence as a WAV file named with its index and resolves played after the audio's duration", async () => {
    const clock = createFakeClock();
    const files: { name: string; bytes: Uint8Array }[] = [];
    const player = createRecordingPlayer({
      write: async (name, bytes) => {
        files.push({ name, bytes });
      },
      clock,
    });
    let result: unknown;
    void player.play(2, chunks(1)).then((r) => (result = r));

    await clock.advance(0);
    await clock.advance(99);
    expect(result).toBeUndefined();
    await clock.advance(1);
    expect(result).toEqual({ played: true });
    expect(files).toHaveLength(1);
    expect(files[0].name).toContain("2");
    expect(ascii(files[0].bytes, 0, 4)).toBe("RIFF");
    expect(dataBytes(files[0].bytes)).toEqual({
      header: "data",
      size: 4800,
    });
  });

  test("stopping resolves the running and the pending sentence as not played and keeps only the audio written before the stop", async () => {
    const clock = createFakeClock();
    const files: { name: string; bytes: Uint8Array }[] = [];
    const player = createRecordingPlayer({
      write: async (name, bytes) => {
        files.push({ name, bytes });
      },
      clock,
    });
    const first = player.play(0, chunks(10));
    const second = player.play(1, chunks(1));

    await clock.advance(0);
    await clock.advance(100);
    const to200 = clock.advance(100);
    player.stop();
    await to200;

    expect(await first).toEqual({ played: false });
    expect(await second).toEqual({ played: false });
    expect(files).toHaveLength(1);
    expect(files[0].name).toContain("0");
    expect(dataBytes(files[0].bytes).size).toBe(9600);
  });
});
