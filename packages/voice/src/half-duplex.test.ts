import { describe, expect, test } from "vitest";
import type { AudioChunk, AudioFormat } from "./audio.js";
import { createHalfDuplex } from "./half-duplex.js";
import { createLevelListener } from "./level-listener.js";
import type { Microphone } from "./microphone.js";
import type { PlaybackEnd, Player } from "./player.js";

const format: AudioFormat = {
  encoding: "pcm-s16le",
  sampleRate: 1000,
  channels: 1,
};

const chunk = (bytes: number[]): AudioChunk => ({
  format,
  data: new Uint8Array(bytes),
});

// Audio whose first chunk is delivered once the test releases it.
const gatedAudio = () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const audio = (async function* (): AsyncGenerator<AudioChunk> {
    await gate;
    yield chunk([9, 9]);
  })();
  return { audio, release };
};

const sounds = (): AsyncIterable<AudioChunk> => {
  const { audio, release } = gatedAudio();
  release();
  return audio;
};

// A microphone whose chunks are pushed by the test, one at a time.
const pushedMicrophone = () => {
  const queue: AudioChunk[] = [];
  let wake: (() => void) | undefined;
  const microphone: Microphone = {
    async *open() {
      while (true) {
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
  return {
    microphone,
    push(item: AudioChunk) {
      queue.push(item);
      wake?.();
    },
  };
};

const fakePlayer = () => {
  const pending: ((end: PlaybackEnd) => void)[] = [];
  const player: Player = {
    async play(_index, audio) {
      for await (const delivered of audio) void delivered;
      return new Promise<PlaybackEnd>((resolve) =>
        pending.push(resolve),
      );
    },
    stop() {},
  };
  return {
    player,
    finish: () => pending.shift()?.({ played: true }),
  };
};

const setup = () => {
  let time = 0;
  const mic = pushedMicrophone();
  const fake = fakePlayer();
  const joined = createHalfDuplex({
    microphone: mic.microphone,
    player: fake.player,
    tailMs: 500,
    now: () => time,
  });
  const opened = joined.microphone.open(new AbortController().signal);
  const stream = opened[Symbol.asyncIterator]();
  const next = async (bytes: number[]): Promise<number[]> => {
    mic.push(chunk(bytes));
    const result = await stream.next();
    return Array.from((result.value as AudioChunk).data);
  };
  return {
    fake,
    joined,
    next,
    at: (ms: number) => void (time = ms),
  };
};

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe("half duplex", () => {
  test("gives zeros of the same length for chunks that arrive while the player plays", async () => {
    const s = setup();
    void s.joined.player.play(0, sounds());
    await settle();
    expect(await s.next([1, 2, 3, 4])).toEqual([0, 0, 0, 0]);
    expect(await s.next([5, 6])).toEqual([0, 0]);
  });

  test("gives zeros 499 ms after playback ended and the audio itself at 500 ms", async () => {
    const s = setup();
    s.at(1000);
    const played = s.joined.player.play(0, sounds());
    await settle();
    s.fake.finish();
    await played;
    s.at(1499);
    expect(await s.next([1, 2])).toEqual([0, 0]);
    s.at(1500);
    expect(await s.next([3, 4])).toEqual([3, 4]);
  });

  test("passes chunks through unchanged while nothing plays", async () => {
    const s = setup();
    expect(await s.next([7, 8, 9, 10])).toEqual([7, 8, 9, 10]);
  });

  test("passes a chunk through unchanged while the audio of a play has not yielded, and gives zeros once it has", async () => {
    const s = setup();
    const gated = gatedAudio();
    void s.joined.player.play(0, gated.audio);
    await settle();
    expect(await s.next([1, 2])).toEqual([1, 2]);
    gated.release();
    await settle();
    expect(await s.next([3, 4])).toEqual([0, 0]);
  });
});

describe("half duplex with the level listener", () => {
  test("yields one utterance that starts with the person's audio, not the echo", async () => {
    const ECHO = 5000;
    const PERSON = 3277;
    const QUIET = 33;
    let time = 0;
    const fake = fakePlayer();
    const sample = (ms: number): number =>
      ms < 1000 ? ECHO : ms >= 1600 && ms < 1800 ? PERSON : QUIET;
    const raw: Microphone = {
      async *open() {
        for (let ms = 0; ms < 2800; ms++) {
          time = ms;
          if (ms === 0) {
            void joined.player.play(0, sounds());
            await settle();
          }
          if (ms === 1000) {
            fake.finish();
            await settle();
          }
          const data = new Uint8Array(2);
          new DataView(data.buffer).setInt16(0, sample(ms), true);
          yield { format, data };
        }
      },
    };
    const joined = createHalfDuplex({
      microphone: raw,
      player: fake.player,
      tailMs: 500,
      now: () => time,
    });
    const listener = createLevelListener({
      microphone: joined.microphone,
      levelDb: -40,
      startMs: 100,
      endMs: 800,
      leadMs: 300,
    });
    const utterances: number[][] = [];
    for await (const utterance of listener.listen(
      new AbortController().signal,
    )) {
      const values: number[] = [];
      for await (const c of utterance.audio) {
        const view = new DataView(c.data.buffer, c.data.byteOffset);
        for (let at = 0; at < c.data.length; at += 2) {
          values.push(view.getInt16(at, true));
        }
      }
      utterances.push(values);
    }
    const tone = (n: number, v: number) => Array<number>(n).fill(v);
    expect(utterances).toEqual([
      [
        ...tone(200, 0),
        ...tone(100, QUIET),
        ...tone(200, PERSON),
        ...tone(800, QUIET),
      ],
    ]);
  });
});
