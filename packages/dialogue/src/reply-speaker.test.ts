import type {
  AudioChunk,
  Player,
  PlaybackEnd,
  SpeechSynthesizer,
} from "@mg/voice";
import { describe, expect, test, vi } from "vitest";
import { createReplySpeaker } from "./reply-speaker.js";

const format = {
  encoding: "pcm-s16le",
  sampleRate: 16000,
  channels: 1,
} as const;

type FakeSynthesizer = SpeechSynthesizer & { asked: string[] };

const fakeSynthesizer = (failOn?: string): FakeSynthesizer => {
  const asked: string[] = [];
  return {
    asked,
    synthesize(text) {
      asked.push(text);
      return (async function* (): AsyncGenerator<AudioChunk> {
        if (text === failOn) throw new Error("quota");
        yield { format, data: new TextEncoder().encode(text) };
      })();
    },
  };
};

type FakePlayer = Player & {
  received: { index: number; text: string }[];
  stopCalls: number;
};

const fakePlayer = (
  behaviour: (index: number) => Promise<PlaybackEnd> | "hold",
): FakePlayer => {
  const held: ((end: PlaybackEnd) => void)[] = [];
  const player: FakePlayer = {
    received: [],
    stopCalls: 0,
    async play(index, audio) {
      let text = "";
      for await (const chunk of audio) {
        text += new TextDecoder().decode(chunk.data);
      }
      player.received.push({ index, text });
      const result = behaviour(index);
      if (result !== "hold") return result;
      return new Promise<PlaybackEnd>((resolve) => held.push(resolve));
    },
    stop() {
      player.stopCalls += 1;
      for (const resolve of held.splice(0)) resolve({ played: false });
    },
  };
  return player;
};

const playsEverything = () =>
  fakePlayer(async () => ({ played: true }));

describe("createReplySpeaker", () => {
  test("plays each complete sentence in order and reports the whole text as heard", async () => {
    const player = playsEverything();
    const speaker = createReplySpeaker({
      synthesizer: fakeSynthesizer(),
      player,
    });
    speaker.push("こんにちは。今日は");
    speaker.push("晴れです。");
    speaker.end();
    expect(await speaker.done).toEqual({ heard: 14 });
    expect(player.received).toEqual([
      { index: 0, text: "こんにちは。" },
      { index: 1, text: "今日は晴れです。" },
    ]);
  });

  test("plays a last partial sentence when the text ends", async () => {
    const player = playsEverything();
    const speaker = createReplySpeaker({
      synthesizer: fakeSynthesizer(),
      player,
    });
    speaker.push("はい");
    speaker.end();
    await speaker.done;
    expect(player.received).toEqual([{ index: 0, text: "はい" }]);
  });

  test("stops the player, synthesizes nothing more and reports up to the last played sentence when stopped", async () => {
    const synthesizer = fakeSynthesizer();
    const player = fakePlayer((index) =>
      index === 0 ? Promise.resolve({ played: true }) : "hold",
    );
    const speaker = createReplySpeaker({ synthesizer, player });
    speaker.push("一つ目。二つ目。三つ目。");
    speaker.end();
    await vi.waitFor(() => expect(player.received).toHaveLength(2));
    speaker.stop();
    expect(await speaker.done).toEqual({ heard: 4 });
    expect(player.stopCalls).toBe(1);
    expect(synthesizer.asked).not.toContain("三つ目。");
  });

  test("stops after the last played sentence and reports the reason when the synthesizer fails", async () => {
    const player = playsEverything();
    const speaker = createReplySpeaker({
      synthesizer: fakeSynthesizer("二つ目。"),
      player,
    });
    speaker.push("一つ目。二つ目。三つ目。");
    speaker.end();
    expect(await speaker.done).toEqual({
      heard: 4,
      failed: "synthesizer",
      reason: "quota",
    });
    expect(player.received.map((r) => r.index)).toEqual([0]);
  });

  test("reports a device failure with its reason when the player rejects", async () => {
    const player = fakePlayer(() =>
      Promise.reject(new Error("no device")),
    );
    const speaker = createReplySpeaker({
      synthesizer: fakeSynthesizer(),
      player,
    });
    speaker.push("一つ目。");
    speaker.end();
    expect(await speaker.done).toEqual({
      heard: 0,
      failed: "device",
      reason: "no device",
    });
  });
});
