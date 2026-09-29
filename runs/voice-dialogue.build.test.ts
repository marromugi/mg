import type {
  GenerateRequest,
  Provider,
  StreamEvent,
  ToolSchema,
} from "@mg/core";
import { defineTool } from "@mg/core";
import type { ConversationStore } from "@mg/conversation";
import { createMemoryConversationStore } from "@mg/conversation";
import { TalkerError } from "@mg/dialogue";
import type { DialogueEvent, WorkEnding } from "@mg/dialogue";
import type { GatedRunConfig, UngatedRunConfig } from "@mg/runner";
import type { Trigger } from "@mg/trigger";
import { describe, expect, test, vi } from "vitest";
import {
  createTalker,
  createWorker,
  createWorkTrigger,
  printEvent,
} from "./voice-dialogue.build.ts";
import { exchangesText } from "./voice-dialogue.values.ts";

const waitForHalt = (halt: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve) => {
    if (halt?.aborted) {
      resolve();
      return;
    }
    halt?.addEventListener("abort", () => resolve(), { once: true });
  });

// Streams each scripted turn. A turn without a finish event waits for
// the halt signal and then ends as halted.
const streamingProvider = (
  turns: readonly (readonly StreamEvent[])[],
): { provider: Provider; calls: GenerateRequest[] } => {
  const calls: GenerateRequest[] = [];
  const provider: Provider = {
    generate: () => Promise.reject(new Error("not scripted")),
    stream: (request) => {
      calls.push({ ...request, messages: [...request.messages] });
      const events = turns[calls.length - 1] ?? [];
      return (async function* () {
        let finished = false;
        for (const event of events) {
          yield event;
          if (event.type === "finish") finished = true;
        }
        if (finished) return;
        await waitForHalt(request.halt);
        yield { type: "finish", finishReason: "halted" };
      })();
    },
  };
  return { provider, calls };
};

const reply = (
  text: string,
  finishReason: "stop" | "length" = "stop",
): StreamEvent[] => [
  { type: "text-delta", delta: text },
  { type: "finish", finishReason },
];

const harness = { kind: "loop", model: "m", maxTurns: 3 } as const;

const talkerConfig = (provider: Provider): UngatedRunConfig => ({
  name: "talker",
  provider,
  harness,
});

const workerConfig = (
  provider: Provider,
  tools: GatedRunConfig["tools"] = [],
): GatedRunConfig => ({
  name: "worker",
  provider,
  harness,
  tools,
  gate: { judge: async () => ({ allowed: true, reason: "ok" }) },
});

const newStore = async (id: string): Promise<ConversationStore> => {
  const store = createMemoryConversationStore();
  await store.create(id);
  return store;
};

const failingAppend = (
  store: ConversationStore,
  error: Error,
): ConversationStore => ({
  create: (id) => store.create(id),
  read: (id, range) => store.read(id, range),
  append: () => Promise.reject(error),
});

const never = new Promise<number>(() => {});

const replyOptions = (overrides: {
  heard: Promise<number>;
  onText?: (delta: string) => void;
  onTextEnd?: () => void;
  wrapUp?: AbortSignal;
}) => ({
  signal: new AbortController().signal,
  wrapUp: new AbortController().signal,
  onText: () => {},
  onTextEnd: () => {},
  ...overrides,
});

const savedMessages = async (store: ConversationStore, id: string) => {
  const slice = await store.read(id, { kind: "all" });
  return slice.entries.flatMap((entry) => entry.messages);
};

describe("talker", () => {
  test("saves only the heard part of the reply and gives back the run's session id", async () => {
    const store = await newStore("talker");
    const { provider } = streamingProvider([reply("一つ目。二つ目。")]);
    const talker = createTalker({
      config: talkerConfig(provider),
      store,
      id: "talker",
    });

    const result = await talker.reply(
      "こんにちは",
      replyOptions({ heard: Promise.resolve(4) }),
    );

    expect(await savedMessages(store, "talker")).toEqual([
      { role: "user", content: "こんにちは" },
      {
        role: "assistant",
        parts: [{ type: "text", text: "一つ目。" }],
      },
    ]);
    expect(result.sessionId).not.toBe("");
  });

  test("rejects with a talker error naming append-failed when the reply cannot be saved", async () => {
    const store = failingAppend(
      await newStore("talker"),
      new Error("disk full"),
    );
    const { provider } = streamingProvider([reply("一つ目。")]);
    const talker = createTalker({
      config: talkerConfig(provider),
      store,
      id: "talker",
    });

    const rejection = talker
      .reply("こんにちは", replyOptions({ heard: Promise.resolve(4) }))
      .catch((error: unknown) => error);

    const error = await rejection;
    expect(error).toBeInstanceOf(TalkerError);
    expect((error as TalkerError).reason).toContain("append-failed");
  });

  test("says its text is complete once, after the text and before the heard count is awaited", async () => {
    const store = await newStore("talker");
    const { provider } = streamingProvider([reply("一つ目。")]);
    const talker = createTalker({
      config: talkerConfig(provider),
      store,
      id: "talker",
    });

    let resolveHeard!: (heard: number) => void;
    const heard = new Promise<number>((resolve) => {
      resolveHeard = resolve;
    });
    const texts: string[] = [];
    let textEndCalls = 0;
    let textAtEnd = "";

    const result = await talker.reply(
      "こんにちは",
      replyOptions({
        heard,
        onText: (delta) => texts.push(delta),
        onTextEnd: () => {
          textEndCalls += 1;
          textAtEnd = texts.join("");
          resolveHeard(4);
        },
      }),
    );

    expect(textEndCalls).toBe(1);
    expect(textAtEnd).toBe("一つ目。");
    expect(result.sessionId).not.toBe("");
  });

  test("does not say its text is complete when the run ends at a length limit, and rejects naming length", async () => {
    const store = await newStore("talker");
    const { provider } = streamingProvider([reply("一つ", "length")]);
    const talker = createTalker({
      config: talkerConfig(provider),
      store,
      id: "talker",
    });
    const onTextEnd = vi.fn();

    const error = await talker
      .reply("こんにちは", replyOptions({ heard: never, onTextEnd }))
      .catch((caught: unknown) => caught);

    expect(onTextEnd).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(TalkerError);
    expect((error as TalkerError).reason).toContain("length");
  });

  test("keeps the heard part of a wrapped-up reply without saying its text is complete", async () => {
    const store = await newStore("talker");
    const { provider } = streamingProvider([
      [{ type: "text-delta", delta: "一つ目。二つ目。" }],
    ]);
    const talker = createTalker({
      config: talkerConfig(provider),
      store,
      id: "talker",
    });
    const wrapUp = new AbortController();
    const onTextEnd = vi.fn();

    const result = await talker.reply(
      "こんにちは",
      replyOptions({
        heard: Promise.resolve(4),
        onText: () => wrapUp.abort(),
        onTextEnd,
        wrapUp: wrapUp.signal,
      }),
    );

    expect(onTextEnd).not.toHaveBeenCalled();
    expect(await savedMessages(store, "talker")).toEqual([
      { role: "user", content: "こんにちは" },
      {
        role: "assistant",
        parts: [{ type: "text", text: "一つ目。" }],
      },
    ]);
    expect(result.sessionId).not.toBe("");
  });
});

const noopSchema = (): ToolSchema => ({
  "~standard": {
    version: 1,
    vendor: "mg-test",
    validate: (value: unknown) => ({ value }),
    jsonSchema: {
      input: () => ({ type: "object" }),
      output: () => ({ type: "object" }),
    },
  },
});

const workOptions = () => ({
  signal: new AbortController().signal,
  onStart: () => {},
  onEvent: () => {},
});

describe("worker", () => {
  test("continues one work conversation, so the second request sees the first", async () => {
    const store = await newStore("work");
    const { provider, calls } = streamingProvider([
      reply("done"),
      reply("done"),
    ]);
    const worker = createWorker({
      config: workerConfig(provider),
      store,
      id: "work",
    });

    const first = await worker.request("A", workOptions());
    await worker.request("B", workOptions());

    expect(first).toEqual({
      kind: "ended",
      reason: "stop",
      text: "done",
      sessionId: expect.any(String),
    });
    expect(calls[1]?.messages).toEqual([
      { role: "user", content: "A" },
      { role: "assistant", parts: [{ type: "text", text: "done" }] },
      { role: "user", content: "B" },
    ]);
  });

  test("waits while held and starts the run when released", async () => {
    const store = await newStore("work");
    const { provider, calls } = streamingProvider([reply("done")]);
    const worker = createWorker({
      config: workerConfig(provider),
      store,
      id: "work",
    });

    worker.hold();
    const ending = worker.request("A", workOptions());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(0);

    worker.release();
    await ending;
    expect(calls).toHaveLength(1);
  });

  test("ends a wrapped-up run with the stop reason wrapped-up", async () => {
    const store = await newStore("work");
    const { provider, calls } = streamingProvider([
      [
        {
          type: "tool-call",
          toolCall: { id: "c1", name: "noop", arguments: {} },
        },
        { type: "finish", finishReason: "tool_calls" },
      ],
      [{ type: "text-delta", delta: "working" }],
    ]);
    const tool = defineTool({
      reach: async () => ({ kind: "any-local" }),
      name: "noop",
      input: noopSchema(),
      execute: async () => "ok",
    });
    const worker = createWorker({
      config: workerConfig(provider, [tool]),
      store,
      id: "work",
    });

    const ending = worker.request("A", workOptions());
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    worker.wrapUp();

    expect(await ending).toMatchObject({
      kind: "ended",
      reason: "wrapped-up",
    });
  });

  test("gives back failed with the reason when the run throws", async () => {
    const store = await newStore("work");
    const provider: Provider = {
      generate: () => Promise.reject(new Error("boom")),
      stream: () =>
        (async function* (): AsyncGenerator<StreamEvent> {
          throw new Error("boom");
        })(),
    };
    const worker = createWorker({
      config: workerConfig(provider),
      store,
      id: "work",
    });

    const ending: WorkEnding = await worker.request("A", workOptions());

    expect(ending).toEqual({ kind: "failed", reason: "boom" });
  });

  test("gives back failed naming append-failed when the run ended but was not saved", async () => {
    const store = failingAppend(
      await newStore("work"),
      new Error("disk full"),
    );
    const { provider } = streamingProvider([reply("done")]);
    const worker = createWorker({
      config: workerConfig(provider),
      store,
      id: "work",
    });

    const ending = await worker.request("A", workOptions());

    expect(ending.kind).toBe("failed");
    expect((ending as { reason: string }).reason).toContain(
      "append-failed",
    );
  });
});

describe("work trigger", () => {
  test("hands the estimator trigger the exchanges as text", async () => {
    const inputs: { kind: string; text: string }[] = [];
    const trigger: Trigger<{ kind: string; text: string }> = {
      decide: async (input) => {
        inputs.push(input);
        return { fired: true, reason: "r" };
      },
    };
    const workTrigger = createWorkTrigger({
      trigger,
      text: exchangesText,
    });

    await workTrigger.decide({
      exchanges: [{ utterance: "直して", reply: "はい" }],
    });

    expect(inputs).toEqual([
      { kind: "exchanges", text: "person: 直して\ntalker: はい" },
    ]);
  });
});

describe("printer", () => {
  test("writes one line per final transcript, reply, work action, judgment and failure", () => {
    const out: string[] = [];
    const err: string[] = [];
    const print = printEvent(
      (line) => out.push(line),
      (line) => err.push(line),
    );
    const events: DialogueEvent[] = [
      { type: "transcript", text: "こんにちは", final: true },
      { type: "reply", text: "はい" },
      { type: "work", action: "held" },
      { type: "judgment", judge: "stop", answer: "continue" },
      { type: "failure", what: "redirect", reason: "x" },
    ];

    for (const event of events) print(event);

    expect(out).toEqual([
      "you: こんにちは",
      "talker: はい",
      "work: held",
      "judge stop: continue",
    ]);
    expect(err).toEqual(["failed redirect: x"]);
  });
});
