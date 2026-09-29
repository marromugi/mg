import {
  splitSentences,
  type AudioChunk,
  type Player,
  type Sentence,
  type SpeechSynthesizer,
} from "@mg/voice";

export type SpeakOutcome = { heard: number } & (
  | { failed?: undefined }
  | { failed: "synthesizer" | "device"; reason: string }
);

export type ReplySpeaker = {
  push(delta: string): void;
  end(): void;
  stop(): void;
  done: Promise<SpeakOutcome>;
};

export type ReplySpeakerOptions = {
  synthesizer: SpeechSynthesizer;
  player: Player;
};

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// A sentence is synthesized in full before it is played, so a synthesizer
// failure is told apart from a device failure.
async function* replay(
  chunks: AudioChunk[],
): AsyncGenerator<AudioChunk> {
  yield* chunks;
}

export const createReplySpeaker = ({
  synthesizer,
  player,
}: ReplySpeakerOptions): ReplySpeaker => {
  let text = "";
  let next = 0;
  let ended = false;
  let stopped = false;
  const pending: Sentence[] = [];
  let wake: (() => void) | undefined;
  const abort = new AbortController();

  const notify = () => {
    wake?.();
    wake = undefined;
  };

  const split = () => {
    const result = splitSentences(text, next, ended);
    next = result.next;
    pending.push(...result.sentences.filter((s) => s.text !== ""));
  };

  const run = async (): Promise<SpeakOutcome> => {
    let heard = 0;
    let index = 0;
    while (true) {
      if (stopped) return { heard };
      const sentence = pending.shift();
      if (sentence === undefined) {
        if (ended) return { heard: text.length };
        await new Promise<void>((resolve) => (wake = resolve));
        continue;
      }

      const chunks: AudioChunk[] = [];
      try {
        for await (const chunk of synthesizer.synthesize(
          sentence.text,
          {
            signal: abort.signal,
          },
        )) {
          chunks.push(chunk);
        }
      } catch (error) {
        if (stopped) return { heard };
        return {
          heard,
          failed: "synthesizer",
          reason: reasonOf(error),
        };
      }
      if (stopped) return { heard };

      try {
        const end = await player.play(index, replay(chunks));
        if (!end.played) return { heard };
      } catch (error) {
        return { heard, failed: "device", reason: reasonOf(error) };
      }
      heard = sentence.end;
      index += 1;
    }
  };

  return {
    push(delta) {
      if (ended || stopped) return;
      text += delta;
      split();
      notify();
    },
    end() {
      if (ended || stopped) return;
      ended = true;
      split();
      notify();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      abort.abort();
      try {
        player.stop();
      } catch {
        // A stop that fails leaves nothing more to end.
      }
      notify();
    },
    done: run(),
  };
};
