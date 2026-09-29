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

export const createReplySpeaker = ({
  synthesizer,
  player,
}: ReplySpeakerOptions): ReplySpeaker => {
  let text = "";
  let next = 0;
  let ended = false;
  let stopped = false;
  let finished = false;
  let heard = 0;
  const pending: Sentence[] = [];
  let wake: (() => void) | undefined;
  const abort = new AbortController();
  let onStop: ((outcome: SpeakOutcome) => void) | undefined;
  const stopWon = new Promise<SpeakOutcome>((resolve) => {
    onStop = resolve;
  });

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
    let index = 0;
    while (true) {
      if (stopped) return { heard };
      const sentence = pending.shift();
      if (sentence === undefined) {
        if (ended) return { heard: text.length };
        await new Promise<void>((resolve) => (wake = resolve));
        continue;
      }

      // The wrapper records a synthesizer error so that it is told apart
      // from a device failure when play rejects.
      let synthesizerError: { reason: string } | undefined;
      const audio = (async function* (): AsyncGenerator<AudioChunk> {
        try {
          yield* synthesizer.synthesize(sentence.text, {
            signal: abort.signal,
          });
        } catch (error) {
          synthesizerError = { reason: reasonOf(error) };
          throw error;
        }
      })();

      try {
        const end = await player.play(index, audio);
        if (!end.played) return { heard };
      } catch (error) {
        if (synthesizerError !== undefined) {
          return {
            heard,
            failed: "synthesizer",
            reason: synthesizerError.reason,
          };
        }
        return { heard, failed: "device", reason: reasonOf(error) };
      }
      heard = sentence.end;
      index += 1;
    }
  };

  const done = Promise.race([run(), stopWon]).then((outcome) => {
    finished = true;
    return outcome;
  });

  return {
    push(delta) {
      if (ended || stopped || finished) return;
      text += delta;
      split();
      notify();
    },
    end() {
      if (ended || stopped || finished) return;
      ended = true;
      split();
      notify();
    },
    stop() {
      if (stopped || finished) return;
      stopped = true;
      abort.abort();
      try {
        player.stop();
      } catch {
        // A stop that fails leaves nothing more to end.
      }
      onStop?.({ heard });
      notify();
    },
    done,
  };
};
