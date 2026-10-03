import type { AudioChunk, AudioFormat } from "../audio.js";
import type { HeardUtterance, Listener } from "../listener.js";
import type { SpawnedProcess, SpawnProcess } from "./process.js";

// An audio-only AVFoundation input is ":<name>"; ffmpeg matches the name.
const argsFor = (microphone: string, format: AudioFormat): string[] => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "avfoundation",
  "-i",
  `:${microphone}`,
  "-f",
  "s16le",
  "-ar",
  String(format.sampleRate),
  "-ac",
  String(format.channels),
  "pipe:1",
];

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const couldNotStart = (error: unknown): Error =>
  new Error(`ffmpeg could not start: ${messageOf(error)}`, {
    cause: error,
  });

// One recording: the process, and how it ended. `outcome` resolves when
// the process has exited and rejects when that exit is a failure. A
// process the listener ended itself is not a failure, whatever its code
// or signal; one that cannot run always is.
type Recording = {
  process: SpawnedProcess;
  outcome: Promise<void>;
  stop(): void;
};

const record = (
  spawn: SpawnProcess,
  args: string[],
  signal: AbortSignal,
): Recording => {
  let process: SpawnedProcess;
  try {
    process = spawn("ffmpeg", args);
  } catch (error) {
    throw couldNotStart(error);
  }
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    process.kill();
  };
  if (signal.aborted) stop();
  else signal.addEventListener("abort", stop, { once: true });
  const outcome = process.exit.then(
    (exit) => {
      if (stopped) return;
      if ("signal" in exit) {
        throw new Error(`ffmpeg was ended by ${exit.signal}`);
      }
      if (exit.code !== 0) {
        throw new Error(`ffmpeg failed with exit code ${exit.code}`);
      }
    },
    (error: unknown) => {
      throw couldNotStart(error);
    },
  );
  const release = () => signal.removeEventListener("abort", stop);
  outcome.then(release, release);
  return { process, outcome, stop };
};

const never = new Promise<never>(() => {});

async function* audioOf(
  recording: Recording,
  format: AudioFormat,
  aborted: Promise<"aborted">,
): AsyncIterable<AudioChunk> {
  const output = recording.process.stdout[Symbol.asyncIterator]();
  const failed = recording.outcome.then(() => never);
  while (true) {
    const step = await Promise.race([output.next(), failed, aborted]);
    if (step === "aborted") return;
    if (step.done === true) break;
    yield { format, data: step.value };
  }
  await recording.outcome;
}

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
    const aborted = new Promise<"aborted">((resolve) => {
      if (signal.aborted) resolve("aborted");
      else {
        signal.addEventListener("abort", () => resolve("aborted"), {
          once: true,
        });
      }
    });
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
