import type {
  AssistantPart,
  Estimator,
  FinishReason,
  GenerateRequest,
  Provider,
  StreamEvent,
} from "@mg/core";
import type { ConversationStore } from "@mg/conversation";
import { createMemoryConversationStore } from "@mg/conversation";
import type {
  DialogueEvent,
  WorkEnding,
  WorkRequestOptions,
} from "@mg/dialogue";
import { TalkerError } from "@mg/dialogue";
import type { Gate } from "@mg/gate";
import type { GatedRunConfig, UngatedRunConfig } from "@mg/runner";
import { defineRun } from "@mg/runner";
import { createBashTool } from "@mg/tools";
import type { SpeechSynthesizer, Transcriber } from "@mg/voice";
import { describe, expect, test } from "vitest";
import {
  createDialogueCollaborators,
  createTalker,
  createWorker,
  createWorkTrigger,
  printEvent,
} from "./voice-dialogue.build.ts";
import { personaOf } from "./voice-dialogue.test-helper.ts";
import { exchangesText } from "./voice-dialogue.values.ts";

type Turn = {
  deltas?: string[];
  toolCall?: boolean;
  finish?: FinishReason;
  // called after each delta is taken by the consumer
  afterDelta?: (text: string) => void;
  fail?: Error;
};

const fakeProvider = (
  turns: Turn[],
): Provider & { requests: Pick<GenerateRequest, "messages">[] } => {
  const requests: Pick<GenerateRequest, "messages">[] = [];
  return {
    requests,
    toolForcing: true,
    generate: () => Promise.reject(new Error("not used")),
    async *stream(request): AsyncGenerator<StreamEvent> {
      const turn = turns[Math.min(requests.length, turns.length - 1)];
      requests.push({ messages: structuredClone(request.messages) });
      if (turn.fail !== undefined) throw turn.fail;
      let text = "";
      for (const delta of turn.deltas ?? []) {
        text += delta;
        yield { type: "text-delta", delta };
        turn.afterDelta?.(text);
      }
      if (turn.toolCall) {
        yield {
          type: "tool-call",
          toolCall: {
            id: "c1",
            name: "bash",
            arguments: { command: "true" },
          },
        };
      }
      const halted = request.halt?.aborted === true;
      yield {
        type: "finish",
        finishReason: halted
          ? "halted"
          : (turn.finish ?? (turn.toolCall ? "tool_calls" : "stop")),
      };
    },
  };
};

const textOf = (parts: AssistantPart[]) =>
  parts.flatMap((part) => (part.type === "text" ? [part.text] : []));

const talkerConfig = (provider: Provider): UngatedRunConfig =>
  defineRun({
    name: "talker",
    provider,
    harness: { kind: "loop", model: "m", maxTurns: 3 },
  });

const allowGate: Gate = {
  judge: async () => ({ allowed: true, reason: "ok" }),
};

const workerConfig = (provider: Provider): GatedRunConfig =>
  defineRun({
    name: "worker",
    provider,
    harness: { kind: "loop", model: "m", maxTurns: 3 },
    tools: [createBashTool({ cwd: process.cwd() })],
    gate: allowGate,
  });

const failingAppend = (
  store: ConversationStore,
): ConversationStore => ({
  ...store,
  append: () => Promise.reject(new Error("disk")),
});

// heard settles with the reply's length once its text is complete
const replyOptions = () => {
  const events: string[] = [];
  let settle: (heard: number) => void = () => {};
  const heard = new Promise<number>((resolve) => (settle = resolve));
  let text = "";
  return {
    events,
    options: {
      signal: new AbortController().signal,
      wrapUp: new AbortController().signal,
      heard,
      onText: (delta: string) => {
        text += delta;
        events.push(`text:${delta}`);
      },
      onTextEnd: () => {
        events.push("end");
        settle(text.length);
      },
    },
    settle,
  };
};

const workOptions = (): WorkRequestOptions => ({
  signal: new AbortController().signal,
  onStart: () => {},
  onEvent: () => {},
});

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("createTalker as a persona", () => {
  test("gives the model the persona's instruction ahead of the person's message", async () => {
    const store = createMemoryConversationStore();
    await store.create("t");
    const provider = fakeProvider([{ deltas: ["はい"] }]);
    const talker = createTalker({
      config: talkerConfig(provider),
      store,
      id: "t",
      ...personaOf(),
    });

    await talker.reply("こんにちは", replyOptions().options);

    expect(provider.requests[0].messages).toEqual([
      { role: "system", content: "ゆっくり話します" },
      { role: "user", content: "こんにちは" },
    ]);
  });

  test("reflects on the heard part of the reply only and reports the outcome", async () => {
    const store = createMemoryConversationStore();
    await store.create("t");
    const persona = personaOf();
    const talker = createTalker({
      config: talkerConfig(
        fakeProvider([{ deltas: ["一つ目。", "二つ目。"] }]),
      ),
      store,
      id: "t",
      ...persona,
    });

    await talker.reply("こんにちは", {
      ...replyOptions().options,
      heard: Promise.resolve(4),
    });

    expect(persona.remembered).toEqual([
      [
        { role: "system", content: "ゆっくり話します" },
        { role: "user", content: "こんにちは" },
        {
          role: "assistant",
          parts: [{ type: "text", text: "一つ目。" }],
        },
      ],
    ]);
    expect(persona.memories).toEqual([
      {
        updated: true,
        added: ["梨が好き"],
        personaChanged: false,
        forgotten: [],
      },
    ]);
  });

  test("rejects with a talker error when the persona cannot recall", async () => {
    const store = createMemoryConversationStore();
    await store.create("t");
    const talker = createTalker({
      config: talkerConfig(fakeProvider([{ deltas: ["はい"] }])),
      store,
      id: "t",
      ...personaOf({ recallFails: new Error("memory is down") }),
    });

    const reply = talker.reply("こんにちは", replyOptions().options);

    await expect(reply).rejects.toBeInstanceOf(TalkerError);
    await expect(reply).rejects.toMatchObject({
      reason: "memory is down",
    });
  });
});

describe("createTalker", () => {
  test("saves only the characters that were heard and gives back the session id", async () => {
    const store = createMemoryConversationStore();
    await store.create("t");
    const talker = createTalker({
      config: talkerConfig(
        fakeProvider([{ deltas: ["一つ目。", "二つ目。"] }]),
      ),
      store,
      id: "t",
      ...personaOf(),
    });
    const { options } = replyOptions();

    const result = await talker.reply("こんにちは", {
      ...options,
      heard: Promise.resolve(4),
    });

    expect(result).toEqual({ sessionId: expect.any(String) });
    const { entries } = await store.read("t", { kind: "all" });
    expect(entries).toEqual([
      {
        messages: [
          { role: "system", content: "ゆっくり話します" },
          { role: "user", content: "こんにちは" },
          {
            role: "assistant",
            parts: [{ type: "text", text: "一つ目。" }],
          },
        ],
      },
    ]);
  });

  test("rejects with a talker error naming append-failed when the reply cannot be saved", async () => {
    const store = createMemoryConversationStore();
    await store.create("t");
    const talker = createTalker({
      config: talkerConfig(fakeProvider([{ deltas: ["はい"] }])),
      store: failingAppend(store),
      id: "t",
      ...personaOf(),
    });
    const { options } = replyOptions();

    const reply = talker.reply("こんにちは", options);

    await expect(reply).rejects.toBeInstanceOf(TalkerError);
    await expect(reply).rejects.toMatchObject({
      reason: expect.stringContaining("append-failed"),
    });
  });

  test("says the text is complete once, after the last text and before heard settles", async () => {
    const store = createMemoryConversationStore();
    await store.create("t");
    const talker = createTalker({
      config: talkerConfig(fakeProvider([{ deltas: ["一つ目。"] }])),
      store,
      id: "t",
      ...personaOf(),
    });
    const { options, events } = replyOptions();

    const result = await talker.reply("こんにちは", {
      ...options,
      heard: options.heard.then((length) => {
        events.push("heard");
        return length;
      }),
    });

    expect(events).toEqual(["text:一つ目。", "end", "heard"]);
    expect(result).toEqual({ sessionId: expect.any(String) });
  });

  test("never says the text is complete when the run ended at a length limit", async () => {
    const store = createMemoryConversationStore();
    await store.create("t");
    const talker = createTalker({
      config: talkerConfig(
        fakeProvider([{ deltas: ["一つ"], finish: "length" }]),
      ),
      store,
      id: "t",
      ...personaOf(),
    });
    const { options, events } = replyOptions();

    const reply = talker.reply("こんにちは", {
      ...options,
      heard: new Promise<number>(() => {}),
    });

    await expect(reply).rejects.toBeInstanceOf(TalkerError);
    await expect(reply).rejects.toMatchObject({
      reason: expect.stringContaining("length"),
    });
    expect(events).toEqual(["text:一つ"]);
  });

  test("saves what was heard and never says the text is complete when the reply is wrapped up", async () => {
    const store = createMemoryConversationStore();
    await store.create("t");
    const wrapUp = new AbortController();
    const talker = createTalker({
      config: talkerConfig(
        fakeProvider([
          {
            deltas: ["一つ目。", "二つ目。"],
            afterDelta: (text) => {
              if (text === "一つ目。二つ目。") wrapUp.abort();
            },
          },
        ]),
      ),
      store,
      id: "t",
      ...personaOf(),
    });
    const { options, events } = replyOptions();

    const result = await talker.reply("こんにちは", {
      ...options,
      wrapUp: wrapUp.signal,
      heard: Promise.resolve(4),
    });

    expect(events).toEqual(["text:一つ目。", "text:二つ目。"]);
    expect(result).toEqual({ sessionId: expect.any(String) });
    const { entries } = await store.read("t", { kind: "all" });
    const assistant = entries[0].messages[2];
    expect(
      assistant.role === "assistant" ? textOf(assistant.parts) : [],
    ).toEqual(["一つ目。"]);
  });
});

describe("createWorker", () => {
  test("continues one work conversation with each request", async () => {
    const provider = fakeProvider([{ deltas: ["done"] }]);
    const store = createMemoryConversationStore();
    await store.create("w");
    const worker = createWorker({
      config: workerConfig(provider),
      store,
      id: "w",
    });

    const first = await worker.request("A", workOptions());
    const second = await worker.request("B", workOptions());

    expect(first).toEqual({
      kind: "ended",
      reason: "stop",
      text: "done",
      sessionId: expect.any(String),
    });
    expect(second.kind).toBe("ended");
    expect(provider.requests[1].messages).toEqual([
      { role: "user", content: "A" },
      { role: "assistant", parts: [{ type: "text", text: "done" }] },
      { role: "user", content: "B" },
    ]);
  });

  test("does not call the provider while held and does once released", async () => {
    const provider = fakeProvider([{ deltas: ["done"] }]);
    const store = createMemoryConversationStore();
    await store.create("w");
    const worker = createWorker({
      config: workerConfig(provider),
      store,
      id: "w",
    });

    worker.hold();
    const ending = worker.request("A", workOptions());
    await sleep(20);
    const heldCalls = provider.requests.length;
    worker.release();
    await ending;

    expect(heldCalls).toBe(0);
    expect(provider.requests).toHaveLength(1);
  });

  test("ends wrapped-up when it is wrapped up during a two-turn run", async () => {
    const store = createMemoryConversationStore();
    await store.create("w");
    let worker: ReturnType<typeof createWorker> | undefined;
    const provider = fakeProvider([
      { toolCall: true },
      { deltas: ["done"] },
    ]);
    const wrapped: Provider = {
      ...provider,
      stream: (request) => {
        worker?.wrapUp();
        return provider.stream(request);
      },
    };
    worker = createWorker({
      config: workerConfig(wrapped),
      store,
      id: "w",
    });

    const ending = await worker.request("A", workOptions());

    expect(ending).toMatchObject({
      kind: "ended",
      reason: "wrapped-up",
    });
  });

  test("gives back failed with the reason when the provider throws", async () => {
    const store = createMemoryConversationStore();
    await store.create("w");
    const worker = createWorker({
      config: workerConfig(fakeProvider([{ fail: new Error("boom") }])),
      store,
      id: "w",
    });

    const ending: WorkEnding = await worker.request("A", workOptions());

    expect(ending).toEqual({ kind: "failed", reason: "boom" });
  });

  test("gives back failed naming append-failed when the run cannot be saved", async () => {
    const store = createMemoryConversationStore();
    await store.create("w");
    const worker = createWorker({
      config: workerConfig(fakeProvider([{ deltas: ["done"] }])),
      store: failingAppend(store),
      id: "w",
    });

    const ending = await worker.request("A", workOptions());

    expect(ending.kind).toBe("failed");
    expect(ending.kind === "failed" ? ending.reason : "").toContain(
      "append-failed",
    );
  });
});

describe("createWorkTrigger", () => {
  test("hands the trigger the exchanges as text", async () => {
    const seen: unknown[] = [];
    const trigger = createWorkTrigger({
      trigger: {
        decide: async (input) => {
          seen.push(input);
          return { fired: true, reason: "" };
        },
      },
      text: exchangesText,
    });

    await trigger.decide({
      exchanges: [{ utterance: "直して", reply: "はい" }],
    });

    expect(seen).toEqual([
      { kind: "exchanges", text: "person: 直して\ntalker: はい" },
    ]);
  });
});

describe("printEvent", () => {
  test("writes one line per utterance start and end, final transcript, reply, work action, judgment and failure", () => {
    const out: string[] = [];
    const err: string[] = [];
    const print = printEvent(
      (line) => out.push(line),
      (line) => err.push(line),
    );
    const events: DialogueEvent[] = [
      { type: "utterance" },
      { type: "utterance-end" },
      { type: "transcript", text: "こん", final: false },
      { type: "transcript", text: "こんにちは", final: true },
      { type: "reply", text: "はい" },
      { type: "work", action: "held" },
      { type: "judgment", judge: "stop", answer: "continue" },
      { type: "failure", what: "redirect", reason: "x" },
    ];

    for (const event of events) print(event);

    expect(out).toEqual([
      "utterance: started",
      "utterance: ended",
      "you: こんにちは",
      "talker: はい",
      "work: held",
      "judge stop: continue",
    ]);
    expect(err).toEqual(["failed redirect: x"]);
  });
});

describe("createDialogueCollaborators", () => {
  test("stores the talker instruction once, first, however many replies follow", async () => {
    const estimator: Estimator = {
      model: "fake",
      limits: { minLabels: 1, maxLabels: 255, maxLevels: 10 },
      estimate: () => Promise.reject(new Error("not used")),
      classify: () => Promise.reject(new Error("not used")),
      score: () => Promise.reject(new Error("not used")),
    };
    const talkerStore = createMemoryConversationStore();
    const provider = fakeProvider([{ deltas: ["はい"] }]);
    const collaborators = await createDialogueCollaborators({
      transcriber: {} as Transcriber,
      synthesizer: {} as SpeechSynthesizer,
      estimator,
      talker: {
        config: talkerConfig(provider),
        store: talkerStore,
        id: "t",
        ...personaOf(),
      },
      worker: {
        config: workerConfig(provider),
        store: createMemoryConversationStore(),
        id: "w",
      },
      talkerInstruction: "役割",
    });

    for (const message of ["一", "二"]) {
      const { options } = replyOptions();
      await collaborators.talker.reply(message, options);
    }

    const { entries } = await talkerStore.read("t", { kind: "all" });
    const messages = entries.flatMap((entry) => entry.messages);
    expect(
      messages.filter(
        (m) => m.role === "system" && m.content === "役割",
      ),
    ).toEqual([{ role: "system", content: "役割" }]);
    expect(messages[0]).toEqual({ role: "system", content: "役割" });
  });
});
