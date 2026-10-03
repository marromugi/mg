import type { RunDialogue } from "@mg/dialogue";
import {
  createFfmpegMicrophone,
  createFfmpegPlayer,
  createLevelListener,
} from "@mg/voice";
import type { SpawnProcess } from "@mg/voice";
import type {
  DialogueCollaborators,
  SessionTrace,
} from "./voice-dialogue.build.ts";
import { printEvent } from "./voice-dialogue.build.ts";
import {
  LISTENER_END_MS,
  LISTENER_FORMAT,
  LISTENER_LEAD_MS,
  LISTENER_START_MS,
} from "./voice-dialogue.values.ts";

export type LiveOptions = {
  spawn: SpawnProcess;
  microphone?: string | undefined;
  levelDb: number;
  signal: AbortSignal;
  createCollaborators: () => Promise<DialogueCollaborators>;
  dialogue: RunDialogue;
  openTrace: () => Promise<SessionTrace>;
  out: (line: string) => void;
  err: (line: string) => void;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Runs the dialogue on this machine and returns the exit code.
export const runLive = async (
  options: LiveOptions,
): Promise<number> => {
  const { out, err } = options;

  let collaborators: DialogueCollaborators;
  try {
    collaborators = await options.createCollaborators();
  } catch (error) {
    err(`could not set up the dialogue: ${messageOf(error)}`);
    return 1;
  }

  let trace: SessionTrace;
  try {
    trace = await options.openTrace();
  } catch (error) {
    err(`could not open the trace: ${messageOf(error)}`);
    return 1;
  }
  out(`trace: ${trace.path}`);

  const abort = new AbortController();
  const interrupt = () => abort.abort();
  if (options.signal.aborted) interrupt();
  else
    options.signal.addEventListener("abort", interrupt, { once: true });
  let failure: { error: unknown } | undefined;
  try {
    await options.dialogue(
      {
        ...collaborators,
        listener: createLevelListener({
          microphone: createFfmpegMicrophone({
            spawn: options.spawn,
            microphone: options.microphone,
            format: LISTENER_FORMAT,
          }),
          levelDb: options.levelDb,
          startMs: LISTENER_START_MS,
          endMs: LISTENER_END_MS,
          leadMs: LISTENER_LEAD_MS,
        }),
        player: createFfmpegPlayer({ spawn: options.spawn }),
      },
      {
        signal: abort.signal,
        trace: trace.span,
        onEvent: printEvent(out, err),
      },
    );
  } catch (error) {
    failure = { error };
  }

  const interrupted = options.signal.aborted;
  options.signal.removeEventListener("abort", interrupt);
  // Stops the microphone.
  abort.abort();

  try {
    await trace.close();
  } catch (error) {
    err(`could not close the trace: ${messageOf(error)}`);
    return 1;
  }
  if (interrupted) return 130;
  if (failure !== undefined) {
    err(`failed: ${messageOf(failure.error)}`);
    return 1;
  }
  return 0;
};
