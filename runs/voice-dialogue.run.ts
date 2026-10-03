import type { RunDialogue } from "@mg/dialogue";
import { createFfmpegKeyListener, createFfmpegPlayer } from "@mg/voice";
import type { SpawnProcess } from "@mg/voice";
import type {
  DialogueCollaborators,
  SessionTrace,
} from "./voice-dialogue.build.ts";
import { printEvent } from "./voice-dialogue.build.ts";
import { keyPresses } from "./voice-dialogue.keys.ts";
import type { TerminalInput } from "./voice-dialogue.keys.ts";
import { LISTENER_FORMAT } from "./voice-dialogue.values.ts";

export type LiveOptions = {
  input: TerminalInput;
  spawn: SpawnProcess;
  microphone?: string | undefined;
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
  let failure: { error: unknown } | undefined;
  try {
    await options.dialogue(
      {
        ...collaborators,
        listener: createFfmpegKeyListener({
          spawn: options.spawn,
          keys: keyPresses(options.input, abort),
          microphone: options.microphone,
          format: LISTENER_FORMAT,
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

  // Ctrl-C is the only thing that aborts the controller before this point.
  const interrupted = abort.signal.aborted;
  // Ends the key stream, which restores the terminal.
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
