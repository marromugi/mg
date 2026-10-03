import type { AudioFormat } from "../audio.js";
import type { HeardUtterance, Listener } from "../listener.js";
import type { SpawnProcess } from "./process.js";
import { argsFor, audioOf, record, whenAborted } from "./recording.js";

// A key press while idle starts an utterance, and the next press ends it.
// The audio is the microphone read through ffmpeg in `format`. The
// microphone is named as macOS shows it; without a name it is the
// system's default input.
export const createFfmpegKeyListener = ({
  spawn,
  keys,
  microphone = "default",
  format,
}: {
  spawn: SpawnProcess;
  keys: AsyncIterable<void>;
  microphone?: string | undefined;
  format: AudioFormat;
}): Listener => ({
  async *listen(signal): AsyncIterable<HeardUtterance> {
    const iterator = keys[Symbol.asyncIterator]();
    let pending: Promise<IteratorResult<void>> | undefined;
    const press = () => (pending ??= iterator.next());
    const aborted = whenAborted(signal);
    try {
      while (!signal.aborted) {
        const first = await Promise.race([press(), aborted]);
        if (first === "aborted" || first.done === true) return;
        pending = undefined;
        const recording = record(
          spawn,
          argsFor(microphone, format),
          signal,
        );
        recording.outcome.catch(() => {});
        press().then(
          (next) => {
            if (next.done !== true) pending = undefined;
            recording.stop();
          },
          () => recording.stop(),
        );
        yield { audio: audioOf(recording, format, aborted) };
        await recording.outcome;
      }
    } finally {
      void Promise.resolve(iterator.return?.()).catch(() => {});
    }
  },
});
