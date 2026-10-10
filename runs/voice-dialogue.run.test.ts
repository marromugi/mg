import type { Estimator, Provider } from "@mg/core";
import { createMemoryConversationStore } from "@mg/conversation";
import type { RunDialogue } from "@mg/dialogue";
import { noopSpan } from "@mg/harness";
import type { AudioChunk, SpawnProcess } from "@mg/voice";
import { describe, expect, test } from "vitest";
import type {
  DialogueCollaborators,
  SessionTrace,
} from "./voice-dialogue.build.ts";
import {
  createDialogueCollaborators,
  createTalkerConfig,
  createWorkerConfig,
} from "./voice-dialogue.build.ts";
import { runLive } from "./voice-dialogue.run.ts";
import { personaOf } from "./voice-dialogue.test-helper.ts";

const unusedProvider: Provider = {
  toolForcing: true,
  generate: () => Promise.reject(new Error("not used")),
  stream: () => {
    throw new Error("not used");
  },
};

const estimator: Estimator = {
  model: "fake",
  limits: { minLabels: 1, maxLabels: 255, maxLevels: 10 },
  estimate: () => Promise.reject(new Error("not used")),
  classify: () => Promise.reject(new Error("not used")),
  score: () => Promise.reject(new Error("not used")),
};

const realCollaborators = () =>
  createDialogueCollaborators({
    transcriber: {} as never,
    synthesizer: {} as never,
    estimator,
    talker: {
      config: createTalkerConfig({
        provider: unusedProvider,
        jsonlPath: "run.jsonl",
      }),
      store: createMemoryConversationStore(),
      id: "t",
      ...personaOf(),
    },
    worker: {
      config: createWorkerConfig({
        provider: unusedProvider,
        estimator,
        jsonlPath: "run.jsonl",
      }),
      store: createMemoryConversationStore(),
      id: "w",
    },
  });

// Runs until it is stopped, as the dialogue does.
const listening: RunDialogue = async (_options, context) => {
  await new Promise<void>((resolve) => {
    if (context.signal.aborted) resolve();
    else context.signal.addEventListener("abort", () => resolve());
  });
};

const flush = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

// An ffmpeg that writes one second of audio at about -20 dB, then exits.
const loudFfmpeg: SpawnProcess = () => {
  const second = new Uint8Array(32000);
  const view = new DataView(second.buffer);
  for (let at = 0; at < 16000; at++) view.setInt16(at * 2, 3277, true);
  return {
    stdin: { write: () => {}, end: () => {} },
    stdout: (async function* () {
      yield second;
    })(),
    exit: Promise.resolve({ code: 0 }),
    kill: () => {},
  };
};

const setup = (options: {
  createCollaborators?: () => Promise<DialogueCollaborators>;
  closeTrace?: () => Promise<void>;
  dialogue?: RunDialogue;
  spawn?: SpawnProcess;
  levelDb?: number;
}) => {
  const interrupt = new AbortController();
  const out: string[] = [];
  const err: string[] = [];
  const spawned: string[] = [];
  const spawn: SpawnProcess =
    options.spawn ??
    ((command) => {
      spawned.push(command);
      throw new Error("not used");
    });
  const trace: SessionTrace = {
    path: "trace.jsonl",
    span: noopSpan,
    close: options.closeTrace ?? (async () => {}),
  };
  const run = runLive({
    spawn,
    levelDb: options.levelDb ?? -40,
    signal: interrupt.signal,
    createCollaborators:
      options.createCollaborators ?? realCollaborators,
    dialogue: options.dialogue ?? listening,
    openTrace: async () => trace,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { interrupt, run, out, err, spawned };
};

describe("runLive", () => {
  test("exits 130 when interrupted", async () => {
    const t = setup({});
    await flush();

    t.interrupt.abort();
    const code = await t.run;

    expect(code).toBe(130);
  });

  test("exits 1 and prints why when the dialogue fails without an interrupt", async () => {
    const t = setup({
      dialogue: async () => {
        throw new Error("ffmpeg failed with exit code 1");
      },
    });

    const code = await t.run;

    expect(code).toBe(1);
    expect(t.err).toEqual(["failed: ffmpeg failed with exit code 1"]);
  });

  test("prints why and exits 1 without spawning when setup rejects", async () => {
    const t = setup({
      createCollaborators: () => Promise.reject(new Error("disk")),
    });

    const code = await t.run;

    expect(t.err.join("\n")).toContain("disk");
    expect(code).toBe(1);
    expect(t.spawned).toEqual([]);
  });

  test("prints why and exits 1 when the trace cannot be closed", async () => {
    const t = setup({
      closeTrace: () => Promise.reject(new Error("disk")),
    });
    await flush();

    t.interrupt.abort();
    const code = await t.run;

    expect(t.err.join("\n")).toContain("disk");
    expect(code).toBe(1);
  });

  describe("the listener the dialogue gets", () => {
    const heardWith = async (levelDb: number): Promise<number> => {
      let heard = 0;
      const t = setup({
        spawn: loudFfmpeg,
        levelDb,
        dialogue: async (options, context) => {
          for await (const utterance of options.listener.listen(
            context.signal,
          )) {
            const chunks: AudioChunk[] = [];
            for await (const chunk of utterance.audio) {
              chunks.push(chunk);
            }
            heard++;
          }
        },
      });
      await t.run;
      return heard;
    };

    test("hears sound above the level as an utterance", async () => {
      expect(await heardWith(-40)).toBe(1);
    });

    test("hears nothing when the level is above the sound", async () => {
      expect(await heardWith(-10)).toBe(0);
    });
  });
});
