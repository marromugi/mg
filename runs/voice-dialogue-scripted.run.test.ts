import type { Estimator, Provider } from "@mg/core";
import type { ConversationStore } from "@mg/conversation";
import { createMemoryConversationStore } from "@mg/conversation";
import type { RunDialogue } from "@mg/dialogue";
import { noopSpan } from "@mg/harness";
import type { Clock, SpeechSynthesizer, Transcriber } from "@mg/voice";
import { describe, expect, test } from "vitest";
import {
  createTalkerConfig,
  createWorkerConfig,
} from "./voice-dialogue.build.ts";
import type { SessionTrace } from "./voice-dialogue.build.ts";
import { runScripted } from "./voice-dialogue-scripted.run.ts";

const flush = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

type Timer = { at: number; fire: () => void };

const createFakeClock = () => {
  let now = 0;
  const timers = new Set<Timer>();
  const clock: Clock = {
    now: () => now,
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        const timer: Timer = {
          at: now + ms,
          fire: () => {
            timers.delete(timer);
            resolve();
          },
        };
        timers.add(timer);
        signal?.addEventListener("abort", () => {
          timers.delete(timer);
          reject(signal.reason);
        });
      }),
  };
  const drive = async <T>(promise: Promise<T>): Promise<T> => {
    let finished = false;
    void promise.then(
      () => (finished = true),
      () => (finished = true),
    );
    for (;;) {
      await flush();
      if (finished) return promise;
      const next = [...timers].sort((a, b) => a.at - b.at)[0];
      if (next === undefined) {
        await flush();
        if (finished) return promise;
        throw new Error("nothing is waiting on the clock");
      }
      now = Math.max(now, next.at);
      next.fire();
    }
  };
  return { clock, drive };
};

const wav = (bits: number): Uint8Array => {
  const data = new Uint8Array(3200);
  const out = new Uint8Array(44 + data.length);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) out[at + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + data.length, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 16000 * (bits / 8), true);
  view.setUint16(32, bits / 8, true);
  view.setUint16(34, bits, true);
  text(36, "data");
  view.setUint32(40, data.length, true);
  out.set(data, 44);
  return out;
};

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

const setup = (options: {
  script: unknown;
  dialogue: (clock: Clock) => RunDialogue;
  talkerStore?: ConversationStore;
  wavBits?: number;
  closeTrace?: () => Promise<void>;
}) => {
  const { clock, drive } = createFakeClock();
  const files = new Map<string, Uint8Array>([
    [
      "script.json",
      new TextEncoder().encode(JSON.stringify(options.script)),
    ],
    ["1.wav", wav(options.wavBits ?? 16)],
    ["2.wav", wav(options.wavBits ?? 16)],
    ["3.wav", wav(options.wavBits ?? 16)],
  ]);
  const out: string[] = [];
  const err: string[] = [];
  const written: string[] = [];
  const closed = { count: 0 };
  const trace: SessionTrace = {
    path: "trace.jsonl",
    span: noopSpan,
    close:
      options.closeTrace ??
      (async () => {
        closed.count += 1;
      }),
  };
  const run = () =>
    drive(
      runScripted({
        scriptPath: "script.json",
        readFile: async (path) => {
          const file = files.get(path);
          if (file === undefined)
            throw new Error(`no such file: ${path}`);
          return file;
        },
        collaborators: {
          transcriber: {} as Transcriber,
          synthesizer: {} as SpeechSynthesizer,
          estimator,
          talker: {
            config: createTalkerConfig({
              provider: unusedProvider,
              jsonlPath: "run.jsonl",
            }),
            store:
              options.talkerStore ?? createMemoryConversationStore(),
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
        },
        dialogue: options.dialogue(clock),
        clock,
        writeWav: async (name) => {
          written.push(name);
        },
        outputDir: "out",
        openTrace: async () => trace,
        out: (line) => out.push(line),
        err: (line) => err.push(line),
        signal: new AbortController().signal,
      }),
    );
  return { clock, run, out, err, written, closed };
};

type Log = { yielded: number[]; listeningEnded?: number };

// Yields what the listener yields, recording when; reports one work
// request at requestAt when given.
const fakeDialogue =
  (
    clock: Clock,
    requestAt: number | undefined,
    log: Log,
  ): RunDialogue =>
  async (options, context) => {
    const requested =
      requestAt === undefined
        ? Promise.resolve()
        : clock.sleep(requestAt).then(() => {
            context.onEvent?.({ type: "work", action: "requested" });
          });
    for await (const utterance of options.listener.listen(
      context.signal,
    )) {
      void utterance;
      log.yielded.push(clock.now());
    }
    log.listeningEnded = clock.now();
    await requested;
  };

const trailing = {
  wav: "3.wav",
  afterWorkRequested: 500,
  within: 5000,
};
const waitScript = [
  { wav: "1.wav", at: 1000 },
  { wav: "2.wav", afterWorkRequested: 500, within: 5000 },
];

const timedDialogue =
  (requestAt: number | undefined) => (clock: Clock) => {
    const log: Log = { yielded: [] };
    return { log, dialogue: fakeDialogue(clock, requestAt, log) };
  };

const scripted = (script: unknown, requestAt: number | undefined) => {
  let log: Log = { yielded: [] };
  const run = setup({
    script,
    dialogue: (clock) => {
      const made = timedDialogue(requestAt)(clock);
      log = made.log;
      return made.dialogue;
    },
  });
  return { ...run, log: () => log };
};

describe("runScripted", () => {
  test("starts an item after the work request it waits for, not before", async () => {
    const t = scripted(waitScript, 2000);

    const code = await t.run();

    expect(t.log().yielded).toEqual([1000, 2500]);
    expect(code).toBe(0);
    expect(t.closed.count).toBe(1);
  });

  test("ends listening when work was not requested within the limit, then exits 1", async () => {
    const t = scripted(waitScript, undefined);

    const code = await t.run();

    expect(t.log().yielded).toEqual([1000]);
    expect(t.log().listeningEnded).toBe(6000);
    expect(t.err).toHaveLength(1);
    expect(t.err[0]).toContain("item 2");
    expect(t.err[0]).toContain("work was not requested");
    expect(t.closed.count).toBe(1);
    expect(code).toBe(1);
  });

  test("counts the limit from the start of the previous item and names the item that waited", async () => {
    const t = scripted([...waitScript, trailing], 2000);

    const code = await t.run();

    expect(t.log().yielded).toEqual([1000, 2500]);
    expect(t.log().listeningEnded).toBe(7500);
    expect(t.err[0]).toContain("item 3");
    expect(t.err[0]).toContain("work was not requested");
    expect(code).toBe(1);
  });

  test("refuses a script whose first item waits for work, naming item 1", async () => {
    const t = scripted(
      [{ wav: "1.wav", afterWorkRequested: 0, within: 1000 }],
      undefined,
    );

    const code = await t.run();

    expect(code).toBe(1);
    expect(t.err.join("\n")).toContain("item 1");
    expect(t.log().listeningEnded).toBeUndefined();
  });

  test("exits 1 before starting, naming the file, when a WAV is not 16-bit PCM", async () => {
    const t = setup({
      script: [{ wav: "1.wav", at: 0 }],
      dialogue: () => async () => {
        throw new Error("the dialogue must not start");
      },
      wavBits: 8,
    });

    const code = await t.run();

    expect(code).toBe(1);
    expect(t.err.join("\n")).toContain("1.wav");
    expect(t.written).toEqual([]);
  });

  test("prints why and exits 1 when the trace cannot be closed", async () => {
    const t = setup({
      script: [{ wav: "1.wav", at: 0 }],
      dialogue: (clock) => timedDialogue(undefined)(clock).dialogue,
      closeTrace: () => Promise.reject(new Error("disk")),
    });

    const code = await t.run();

    expect(t.err.join("\n")).toContain("disk");
    expect(code).toBe(1);
  });

  test("prints why and exits 1 before starting when the talker conversation cannot be seeded", async () => {
    const store = createMemoryConversationStore();
    const t = setup({
      script: [{ wav: "1.wav", at: 0 }],
      dialogue: () => async () => {
        throw new Error("the dialogue must not start");
      },
      talkerStore: {
        ...store,
        append: () => Promise.reject(new Error("disk")),
      },
    });

    const code = await t.run();

    expect(t.err.join("\n")).toContain("disk");
    expect(code).toBe(1);
    expect(t.written).toEqual([]);
  });
});
