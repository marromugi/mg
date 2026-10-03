import type { AudioFormat } from "../audio.js";
import type { Microphone } from "../microphone.js";
import type { SpawnProcess } from "./process.js";
import { argsFor, audioOf, record, whenAborted } from "./recording.js";

// The microphone read through ffmpeg in `format`, from open until the
// signal fires. The microphone is named as macOS shows it; without a
// name it is the system's default input.
export const createFfmpegMicrophone = ({
  spawn,
  microphone = "default",
  format,
}: {
  spawn: SpawnProcess;
  microphone?: string | undefined;
  format: AudioFormat;
}): Microphone => ({
  async *open(signal) {
    const recording = record(
      spawn,
      argsFor(microphone, format),
      signal,
    );
    recording.outcome.catch(() => {});
    yield* audioOf(recording, format, whenAborted(signal));
  },
});
