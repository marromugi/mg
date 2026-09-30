import type { Estimator, Provider } from "@mg/core";
import { createMemoryConversationStore } from "@mg/conversation";
import type { RunDialogue } from "@mg/dialogue";
import { noopSpan } from "@mg/harness";
import type { SpawnProcess } from "@mg/voice";
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
import { createFakeInput, flush } from "./fake-terminal.ts";

const unusedProvider: Provider = {
  generate: () => Promise.reject(new Error("not used")),
  stream: () => {
    throw new Error("not used");
  },
};

const estimator: Estimator = {
  model: "fake",
  limits: { maxLabels: 255, maxLevels: 10 },
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

// Listens until listening ends, as the dialogue does.
const listening: RunDialogue = async (options, context) => {
  for await (const utterance of options.listener.listen(
    context.signal,
  )) {
    void utterance;
  }
};

const setup = (options: {
  createCollaborators?: () => Promise<DialogueCollaborators>;
  closeTrace?: () => Promise<void>;
  dialogue?: RunDialogue;
}) => {
  const terminal = createFakeInput();
  const out: string[] = [];
  const err: string[] = [];
  const spawned: string[] = [];
  const spawn: SpawnProcess = (command) => {
    spawned.push(command);
    throw new Error("not used");
  };
  const trace: SessionTrace = {
    path: "trace.jsonl",
    span: noopSpan,
    close: options.closeTrace ?? (async () => {}),
  };
  const run = runLive({
    input: terminal.input,
    spawn,
    createCollaborators:
      options.createCollaborators ?? realCollaborators,
    dialogue: options.dialogue ?? listening,
    openTrace: async () => trace,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { terminal, run, out, err, spawned };
};

describe("runLive", () => {
  test("exits 130 with the terminal restored when Ctrl-C is pressed", async () => {
    const t = setup({});
    await flush();

    t.terminal.emit("\u0003");
    const code = await t.run;

    expect(code).toBe(130);
    expect(t.terminal.rawModes).toEqual([true, false]);
  });

  test("exits 1 with the terminal restored when the dialogue fails without Ctrl-C", async () => {
    const t = setup({
      dialogue: async (options, context) => {
        const heard = options.listener.listen(context.signal);
        void heard[Symbol.asyncIterator]().next();
        await flush();
        throw new Error("ffmpeg failed with exit code 1");
      },
    });

    const code = await t.run;
    await flush();

    expect(code).toBe(1);
    expect(t.err).toEqual(["failed: ffmpeg failed with exit code 1"]);
    expect(t.terminal.rawModes).toEqual([true, false]);
  });

  test("prints why and exits 1 without reading the terminal or spawning when setup rejects", async () => {
    const t = setup({
      createCollaborators: () => Promise.reject(new Error("disk")),
    });

    const code = await t.run;

    expect(t.err.join("\n")).toContain("disk");
    expect(code).toBe(1);
    expect(t.terminal.rawModes).toEqual([]);
    expect(t.spawned).toEqual([]);
  });

  test("prints why and exits 1 when the trace cannot be closed", async () => {
    const t = setup({
      closeTrace: () => Promise.reject(new Error("disk")),
    });
    await flush();

    t.terminal.emit("\u0003");
    const code = await t.run;

    expect(t.err.join("\n")).toContain("disk");
    expect(code).toBe(1);
  });
});
