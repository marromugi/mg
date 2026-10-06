import type { RunDialogue } from "@mg/dialogue";
import type {
  AudioChunk,
  Clock,
  HeardUtterance,
  Listener,
} from "@mg/voice";
import {
  createRecordedListener,
  createRecordingPlayer,
  sleepUnlessAborted,
} from "@mg/voice";
import {
  createDialogueCollaborators,
  printEvent,
} from "./voice-dialogue.build.ts";
import type {
  DialogueCollaboratorInputs,
  SessionTrace,
} from "./voice-dialogue.build.ts";
import { workNotRequestedLine } from "./voice-dialogue.values.ts";
import { wavChunks } from "./wav.ts";

export type ScriptItem =
  | { wav: string; at: number }
  | { wav: string; afterWorkRequested: number; within: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const milliseconds = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

// Throws an Error naming the item that is not valid.
export const parseScript = (text: string): ScriptItem[] => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `the script is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error("the script must be a non-empty array of items");
  }
  return json.map((raw: unknown, index): ScriptItem => {
    const position = index + 1;
    if (!isRecord(raw) || typeof raw.wav !== "string") {
      throw new Error(`item ${position}: wav must be a file path`);
    }
    const { wav } = raw;
    if ("at" in raw) {
      if (!milliseconds(raw.at)) {
        throw new Error(`item ${position}: at must be a number of ms`);
      }
      return { wav, at: raw.at };
    }
    if (position === 1) {
      throw new Error(
        "item 1: the first item must start at a time (at); it cannot wait for a work request",
      );
    }
    if (
      !milliseconds(raw.afterWorkRequested) ||
      !milliseconds(raw.within)
    ) {
      throw new Error(
        `item ${position}: give either at, or afterWorkRequested and within, as numbers of ms`,
      );
    }
    return {
      wav,
      afterWorkRequested: raw.afterWorkRequested,
      within: raw.within,
    };
  });
};

type Wait =
  | { kind: "requested"; at: number }
  | { kind: "timeout" }
  | { kind: "aborted" };

const requestedAt =
  (resolve: (wait: Wait) => void) =>
  (at: number): void =>
    resolve({ kind: "requested", at });

// Plays each item through a one-utterance recorded listener once its
// condition holds. workRequested() is told of every work request the
// session reports. When an item's limit passes, listening ends and
// unmetItem() gives that item's position.
export const createScriptListener = ({
  items,
  clock,
}: {
  items: { item: ScriptItem; audio: AudioChunk[] }[];
  clock: Clock;
}) => {
  const requests: number[] = [];
  const waiters = new Set<(at: number) => void>();
  let unmet: number | undefined;

  const awaitRequest = async (
    from: number,
    deadline: number,
    signal: AbortSignal,
  ): Promise<Wait> => {
    if (requests.length > from) {
      return { kind: "requested", at: requests[from] };
    }
    const remaining = deadline - clock.now();
    if (remaining <= 0) return { kind: "timeout" };
    const cancel = new AbortController();
    let arrive!: (at: number) => void;
    const arrived = new Promise<Wait>((resolve) => {
      arrive = requestedAt(resolve);
    });
    waiters.add(arrive);
    const elapsed = sleepUnlessAborted(
      clock,
      remaining,
      AbortSignal.any([signal, cancel.signal]),
    ).then((slept): Wait =>
      slept ? { kind: "timeout" } : { kind: "aborted" },
    );
    try {
      return await Promise.race([arrived, elapsed]);
    } finally {
      waiters.delete(arrive);
      cancel.abort();
    }
  };

  const listener: Listener = {
    async *listen(signal): AsyncIterable<HeardUtterance> {
      const start = clock.now();
      let previousStart = start;
      let seen = 0;
      for (const [index, { item, audio }] of items.entries()) {
        let remaining: number;
        if ("at" in item) {
          remaining = item.at - (clock.now() - start);
        } else {
          const waited = await awaitRequest(
            seen,
            previousStart + item.within,
            signal,
          );
          if (waited.kind === "aborted") return;
          if (waited.kind === "timeout") {
            unmet = index + 1;
            return;
          }
          remaining = waited.at + item.afterWorkRequested - clock.now();
        }
        if (
          remaining > 0 &&
          !(await sleepUnlessAborted(clock, remaining, signal))
        ) {
          return;
        }
        if (signal.aborted) return;
        seen = requests.length;
        previousStart = clock.now();
        yield* createRecordedListener({
          utterances: [{ at: 0, audio }],
          clock,
        }).listen(signal);
      }
    },
  };

  return {
    listener,
    workRequested: () => {
      const at = clock.now();
      requests.push(at);
      for (const wake of waiters) wake(at);
    },
    unmetItem: (): number | undefined => unmet,
  };
};

export type ScriptedOptions = {
  scriptPath: string;
  readFile: (path: string) => Promise<Uint8Array>;
  collaborators: DialogueCollaboratorInputs;
  dialogue: RunDialogue;
  clock: Clock;
  // stores a played sentence's WAV under the output directory
  writeWav: (name: string, bytes: Uint8Array) => Promise<void>;
  outputDir: string;
  openTrace: () => Promise<SessionTrace>;
  out: (line: string) => void;
  err: (line: string) => void;
  signal: AbortSignal;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Runs the dialogue from the script and returns the exit code.
export const runScripted = async (
  options: ScriptedOptions,
): Promise<number> => {
  const { out, err, signal } = options;

  let items: { item: ScriptItem; audio: AudioChunk[] }[];
  try {
    const script = parseScript(
      new TextDecoder().decode(
        await options.readFile(options.scriptPath),
      ),
    );
    items = [];
    for (const item of script) {
      items.push({
        item,
        audio: wavChunks(item.wav, await options.readFile(item.wav)),
      });
    }
  } catch (error) {
    err(messageOf(error));
    return 1;
  }

  let collaborators;
  try {
    collaborators = await createDialogueCollaborators(
      options.collaborators,
    );
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
  out(`output: ${options.outputDir}`);
  out(`trace: ${trace.path}`);

  const script = createScriptListener({ items, clock: options.clock });
  const print = printEvent(out, err);
  let failure: { error: unknown } | undefined;
  try {
    await options.dialogue(
      {
        ...collaborators,
        whileSpeaking: { kind: "interrupt" },
        listener: script.listener,
        player: createRecordingPlayer({
          write: options.writeWav,
          clock: options.clock,
        }),
      },
      {
        signal,
        trace: trace.span,
        onEvent: (event) => {
          print(event);
          if (event.type === "work" && event.action === "requested") {
            script.workRequested();
          }
        },
      },
    );
  } catch (error) {
    failure = { error };
  }

  let code = 0;
  try {
    await trace.close();
  } catch (error) {
    err(`could not close the trace: ${messageOf(error)}`);
    code = 1;
  }
  if (signal.aborted) return 130;
  if (failure !== undefined) {
    err(messageOf(failure.error));
    return 1;
  }
  const unmet = script.unmetItem();
  if (unmet !== undefined) {
    err(workNotRequestedLine(unmet));
    return 1;
  }
  return code;
};
