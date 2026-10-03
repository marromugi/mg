import type { AudioChunk, AudioFormat } from "../audio.js";
import type { SpawnedProcess, SpawnProcess } from "./process.js";

// An audio-only AVFoundation input is ":<name>"; ffmpeg matches the name.
export const argsFor = (
  microphone: string,
  format: AudioFormat,
): string[] => [
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
export type Recording = {
  process: SpawnedProcess;
  outcome: Promise<void>;
  stop(): void;
};

export const record = (
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

export async function* audioOf(
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

export const whenAborted = (signal: AbortSignal): Promise<"aborted"> =>
  new Promise((resolve) => {
    if (signal.aborted) resolve("aborted");
    else {
      signal.addEventListener("abort", () => resolve("aborted"), {
        once: true,
      });
    }
  });
