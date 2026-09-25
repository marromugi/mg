import type {
  AssistantPart,
  FinishReason,
  GenerateRequest,
  Message,
  Provider,
  Tool,
} from "@mg/core";
import { defineTool } from "@mg/core";
import type {
  ConversationEntry,
  ConversationStore,
} from "@mg/conversation";
import {
  ConversationConflictError,
  ConversationNotFoundError,
  createMemoryConversationStore,
} from "@mg/conversation";
import type { HarnessEvent } from "@mg/harness";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import type { RunConfig } from "./config.js";
import type { ContinueOptions } from "./continue-conversation.js";
import {
  continueConversation,
  createContinueConversation,
} from "./continue-conversation.js";
import { keepDelivered } from "./keep-delivered.js";
import type { RunOptions, RunOutcome } from "./run.js";

const ENTRY_A: ConversationEntry = {
  messages: [
    { role: "user", content: "a" },
    { role: "assistant", parts: [{ type: "text", text: "A" }] },
  ],
};

const ENTRY_B: ConversationEntry = {
  messages: [
    { role: "user", content: "b" },
    { role: "assistant", parts: [{ type: "text", text: "B" }] },
  ],
};

const ENTRY_WITH_SYSTEM: ConversationEntry = {
  messages: [
    { role: "user", content: "a" },
    { role: "system", content: "old" },
    { role: "assistant", parts: [{ type: "text", text: "A" }] },
  ],
};

const REPLY: Message = {
  role: "assistant",
  parts: [{ type: "text", text: "ok" }],
};

const runConfig = (provider: Provider, tools?: Tool[]): RunConfig => ({
  name: "example",
  provider,
  harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
  ...(tools !== undefined ? { tools } : {}),
});

const fakeProvider = (options?: {
  parts?: AssistantPart[];
  finishReason?: FinishReason;
  error?: Error;
  beforeRespond?: () => Promise<void>;
}): { provider: Provider; calls: GenerateRequest[] } => {
  const calls: GenerateRequest[] = [];
  const provider: Provider = {
    generate: async (request) => {
      calls.push({ ...request, messages: [...request.messages] });
      if (options?.beforeRespond) await options.beforeRespond();
      if (options?.error) throw options.error;
      return {
        parts: options?.parts ?? [{ type: "text", text: "ok" }],
        finishReason: options?.finishReason ?? "stop",
      };
    },
    stream: () => {
      throw new Error("fakeProvider: stream is not scripted");
    },
  };
  return { provider, calls };
};

const countingReadStore = (
  store: ConversationStore,
): { store: ConversationStore; readCalls: () => number } => {
  let reads = 0;
  return {
    store: {
      create: (id) => store.create(id),
      read: (id, range) => {
        reads += 1;
        return store.read(id, range);
      },
      append: (id, entry, expectedLength) =>
        store.append(id, entry, expectedLength),
    },
    readCalls: () => reads,
  };
};

const echoTool: Tool = defineTool({
  name: "echo",
  input: z.object({ text: z.string() }),
  execute: async () => "pong",
});

describe("continueConversation", () => {
  test("sends the read entries followed by the new messages in order, including a system message among the new ones in its given place, and appends what the run added at that same place", async () => {
    const inner = createMemoryConversationStore();
    await inner.create("jev");
    await inner.append("jev", ENTRY_A, 0);
    const { store, readCalls } = countingReadStore(inner);
    const seen: Message[][] = [];
    const fakeRun = async (
      _config: RunConfig,
      messages: Message[],
    ): Promise<RunOutcome> => {
      seen.push(messages);
      return {
        sessionId: "s1",
        result: {
          reason: "stop",
          messages: [...messages, REPLY],
          usage: { inputTokens: 0, outputTokens: 0 },
        },
      };
    };
    const entrance = createContinueConversation({ run: fakeRun });

    const outcome = await entrance(runConfig(fakeProvider().provider), {
      store,
      id: "jev",
      history: { kind: "all" },
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "be brief" },
      ],
    });

    expect(seen[0]).toEqual([
      ...ENTRY_A.messages,
      { role: "user", content: "hi" },
      { role: "system", content: "be brief" },
    ]);
    expect(outcome.saved).toBe(true);
    expect(outcome.sessionId).toBe("s1");
    if (!outcome.saved) throw new Error("unreachable");
    expect(outcome.result.reason).toBe("stop");
    const slice = await inner.read("jev", { kind: "all" });
    expect(slice.entries[1]?.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "system", content: "be brief" },
      REPLY,
    ]);
    expect(slice.length).toBe(2);
    expect(outcome.entry).toEqual({
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "be brief" },
        REPLY,
      ],
    });
    expect(outcome.entry).toEqual(slice.entries[1]);
    expect(readCalls()).toBe(1);
  });

  test("sends a system message saved from an earlier entry still in its saved place, ahead of the new messages", async () => {
    const store = createMemoryConversationStore();
    await store.create("jev");
    await store.append("jev", ENTRY_WITH_SYSTEM, 0);
    const seen: Message[][] = [];
    const fakeRun = async (
      _config: RunConfig,
      messages: Message[],
    ): Promise<RunOutcome> => {
      seen.push(messages);
      return {
        sessionId: "s1",
        result: {
          reason: "stop",
          messages: [...messages, REPLY],
          usage: { inputTokens: 0, outputTokens: 0 },
        },
      };
    };
    const entrance = createContinueConversation({ run: fakeRun });

    await entrance(runConfig(fakeProvider().provider), {
      store,
      id: "jev",
      history: { kind: "all" },
      messages: [{ role: "user", content: "hi" }],
    });

    expect(seen[0]).toEqual([
      ...ENTRY_WITH_SYSTEM.messages,
      { role: "user", content: "hi" },
    ]);
  });

  test("appends a system message the run itself added, kept in the place the run put it, ahead of the reply", async () => {
    const store = createMemoryConversationStore();
    await store.create("jev");
    const fakeRun = async (
      _config: RunConfig,
      messages: Message[],
    ): Promise<RunOutcome> => ({
      sessionId: "s1",
      result: {
        reason: "stop",
        messages: [
          ...messages,
          { role: "system", content: "recalled" },
          REPLY,
        ],
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    });
    const entrance = createContinueConversation({ run: fakeRun });

    const outcome = await entrance(runConfig(fakeProvider().provider), {
      store,
      id: "jev",
      history: { kind: "all" },
      messages: [{ role: "user", content: "hi" }],
    });

    expect(outcome.saved).toBe(true);
    const slice = await store.read("jev", { kind: "all" });
    expect(slice.entries[0]?.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "system", content: "recalled" },
      REPLY,
    ]);
  });

  test("still appends against the conversation's full length when only the last entries were read", async () => {
    const store = createMemoryConversationStore();
    await store.create("jev");
    await store.append("jev", ENTRY_A, 0);
    await store.append("jev", ENTRY_B, 1);
    const { provider, calls } = fakeProvider();

    const outcome = await continueConversation(runConfig(provider), {
      store,
      id: "jev",
      history: { kind: "last", count: 1 },
      messages: [{ role: "user", content: "hi" }],
    });

    expect(calls[0]?.messages).toEqual([
      ...ENTRY_B.messages,
      { role: "user", content: "hi" },
    ]);
    expect(outcome.saved).toBe(true);
    const slice = await store.read("jev", { kind: "all" });
    expect(slice.length).toBe(3);
  });

  test("rejects with the abort reason without reading the conversation or calling the provider when the signal is already aborted", async () => {
    const inner = createMemoryConversationStore();
    await inner.create("jev");
    const { store, readCalls } = countingReadStore(inner);
    const { provider, calls } = fakeProvider();
    const controller = new AbortController();
    const error = new Error("stop");
    controller.abort(error);

    await expect(
      continueConversation(
        runConfig(provider),
        {
          store,
          id: "jev",
          history: { kind: "all" },
          messages: [{ role: "user", content: "hi" }],
        },
        { signal: controller.signal },
      ),
    ).rejects.toBe(error);

    expect(calls).toHaveLength(0);
    expect(readCalls()).toBe(0);
  });

  test("rejects with ConversationNotFoundError and never calls the provider when the conversation was never created", async () => {
    const store = createMemoryConversationStore();
    const { provider, calls } = fakeProvider();

    const promise = continueConversation(runConfig(provider), {
      store,
      id: "jev",
      history: { kind: "all" },
      messages: [{ role: "user", content: "hi" }],
    });

    await expect(promise).rejects.toBeInstanceOf(
      ConversationNotFoundError,
    );
    await expect(promise).rejects.toMatchObject({
      conversationId: "jev",
    });
    expect(calls).toHaveLength(0);
  });

  test("rejects with the run's own error and appends nothing", async () => {
    const store = createMemoryConversationStore();
    await store.create("jev");
    const error = new Error("provider broke");
    const { provider } = fakeProvider({ error });

    await expect(
      continueConversation(runConfig(provider), {
        store,
        id: "jev",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toBe(error);

    expect(await store.read("jev", { kind: "all" })).toEqual({
      entries: [],
      length: 0,
    });
  });

  test("returns an append-failed outcome carrying the conflict error, without throwing, when another append lands first", async () => {
    const store = createMemoryConversationStore();
    await store.create("jev");
    const { provider } = fakeProvider({
      beforeRespond: async () => {
        await store.append("jev", ENTRY_A, 0);
      },
    });

    const outcome = await continueConversation(runConfig(provider), {
      store,
      id: "jev",
      history: { kind: "all" },
      messages: [{ role: "user", content: "hi" }],
    });

    expect(outcome.saved).toBe(false);
    if (outcome.saved) throw new Error("unreachable");
    expect(outcome.reason.kind).toBe("append-failed");
    if (outcome.reason.kind !== "append-failed")
      throw new Error("unreachable");
    expect(outcome.reason.error).toBeInstanceOf(
      ConversationConflictError,
    );
    expect(outcome.reason.error).toMatchObject({
      expectedLength: 0,
      actualLength: 1,
    });
    expect(outcome.result.reason).toBe("stop");
    expect(outcome.sessionId.length).toBeGreaterThan(0);
    expect(await store.read("jev", { kind: "all" })).toEqual({
      entries: [ENTRY_A],
      length: 1,
    });
  });

  test("appends the tool call and its result as one entry, saving with the max-turns reason", async () => {
    const store = createMemoryConversationStore();
    await store.create("jev");
    const { provider } = fakeProvider({
      parts: [
        {
          type: "tool-call",
          id: "c1",
          name: "echo",
          arguments: { text: "ping" },
        },
      ],
      finishReason: "tool_calls",
    });

    const outcome = await continueConversation(
      runConfig(provider, [echoTool]),
      {
        store,
        id: "jev",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
    );

    expect(outcome.saved).toBe(true);
    expect(outcome.result.reason).toBe("max-turns");
    const slice = await store.read("jev", { kind: "all" });
    expect(slice.entries[0]?.messages).toEqual([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            id: "c1",
            name: "echo",
            arguments: { text: "ping" },
          },
        ],
      },
      { role: "tool", toolCallId: "c1", content: "pong" },
    ]);
  });

  test("appends the cut-off text, saving with the length reason", async () => {
    const store = createMemoryConversationStore();
    await store.create("jev");
    const { provider } = fakeProvider({
      parts: [{ type: "text", text: "cut" }],
      finishReason: "length",
    });

    const outcome = await continueConversation(runConfig(provider), {
      store,
      id: "jev",
      history: { kind: "all" },
      messages: [{ role: "user", content: "hi" }],
    });

    expect(outcome.saved).toBe(true);
    expect(outcome.result.reason).toBe("length");
    const slice = await store.read("jev", { kind: "all" });
    expect(slice.entries[0]?.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", parts: [{ type: "text", text: "cut" }] },
    ]);
  });

  test("passes sessionId through to the returned outcome and onEvent sees the run's events", async () => {
    const store = createMemoryConversationStore();
    await store.create("jev");
    const { provider } = fakeProvider();
    const seen: HarnessEvent["type"][] = [];

    const outcome = await continueConversation(
      runConfig(provider),
      {
        store,
        id: "jev",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
      {
        sessionId: "fixed-session",
        onEvent: (event) => seen.push(event.type),
      },
    );

    expect(outcome.sessionId).toBe("fixed-session");
    expect(seen.at(-1)).toBe("done");
  });
});

describe("createContinueConversation", () => {
  test("passes the given options object straight through to the run function, unchanged", async () => {
    const store = createMemoryConversationStore();
    await store.create("jev");
    const optionsSeen: (RunOptions | undefined)[] = [];
    const fakeRun = async (
      _config: RunConfig,
      messages: Message[],
      options?: RunOptions,
    ): Promise<RunOutcome> => {
      optionsSeen.push(options);
      return {
        sessionId: "s1",
        result: {
          reason: "stop",
          messages: [...messages, REPLY],
          usage: { inputTokens: 0, outputTokens: 0 },
        },
      };
    };
    const entrance = createContinueConversation({ run: fakeRun });
    const options: RunOptions = {
      signal: new AbortController().signal,
      caseId: "k",
      sessionId: "fixed-session",
      onEvent: () => {},
    };

    await entrance(
      runConfig(fakeProvider().provider),
      {
        store,
        id: "jev",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
      options,
    );

    expect(optionsSeen[0]).toBe(options);
  });

  test("forwards the wrap-up signal and the added tools to the run function, and appends the wrapped-up result", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const controller = new AbortController();
    const askTool: Tool = defineTool({
      name: "ask",
      input: z.object({}),
      execute: async () => "queued: w1",
    });
    const optionsSeen: (RunOptions | undefined)[] = [];
    const fakeRun = async (
      _config: RunConfig,
      _messages: Message[],
      options?: RunOptions,
    ): Promise<RunOutcome> => {
      optionsSeen.push(options);
      return {
        sessionId: "s1",
        result: {
          reason: "wrapped-up",
          messages: [
            { role: "user", content: "hi" },
            {
              role: "assistant",
              parts: [{ type: "text", text: "Hel" }],
            },
          ],
          usage: { inputTokens: 0, outputTokens: 0 },
        },
      };
    };
    const entrance = createContinueConversation({ run: fakeRun });

    const outcome = await entrance(
      runConfig(fakeProvider().provider),
      {
        store,
        id: "t1",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
      { wrapUp: controller.signal, tools: [askTool] },
    );

    expect(optionsSeen[0]?.wrapUp).toBe(controller.signal);
    expect(optionsSeen[0]?.tools).toEqual([askTool]);
    expect(outcome.saved).toBe(true);
    if (!outcome.saved) throw new Error("unreachable");
    expect(outcome.entry).toEqual({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", parts: [{ type: "text", text: "Hel" }] },
      ],
    });
    const slice = await store.read("t1", { kind: "all" });
    expect(slice.entries).toEqual([outcome.entry]);
  });

  test("does not append and returns a diverged reason when the run function's returned conversation does not start with what was sent", async () => {
    const store = createMemoryConversationStore();
    await store.create("jev");
    const fakeRun = async (): Promise<RunOutcome> => ({
      sessionId: "s1",
      result: {
        reason: "stop",
        messages: [{ role: "user", content: "HI" }],
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    });
    const entrance = createContinueConversation({ run: fakeRun });

    const outcome = await entrance(runConfig(fakeProvider().provider), {
      store,
      id: "jev",
      history: { kind: "all" },
      messages: [{ role: "user", content: "hi" }],
    });

    expect(outcome.saved).toBe(false);
    expect(outcome).toMatchObject({
      saved: false,
      reason: { kind: "diverged" },
      sessionId: "s1",
      result: { reason: "stop" },
    });
    expect(Object.hasOwn(outcome, "entry")).toBe(false);
    expect(await store.read("jev", { kind: "all" })).toEqual({
      entries: [],
      length: 0,
    });
  });
});

describe("continueConversation with a keep function", () => {
  const A1: Message = {
    role: "assistant",
    parts: [
      { type: "text", text: "Hello there." },
      { type: "tool-call", id: "c1", name: "ask", arguments: {} },
    ],
  };
  const T1: Message = {
    role: "tool",
    toolCallId: "c1",
    content: "queued: w1",
  };
  const A2: Message = {
    role: "assistant",
    parts: [{ type: "text", text: "It is queued. I will tell you." }],
  };

  const fakeRunAppending = (
    ...extra: Message[]
  ): ((
    config: RunConfig,
    messages: Message[],
  ) => Promise<RunOutcome>) => {
    return async (_config, messages) => ({
      sessionId: "s1",
      result: {
        reason: "stop",
        messages: [...messages, ...extra],
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    });
  };

  const entranceWith = (
    keep: ContinueOptions["keep"],
    ...extra: Message[]
  ) => {
    const store = createMemoryConversationStore();
    const entrance = createContinueConversation({
      run: fakeRunAppending(...extra),
    });
    return { store, entrance, keep };
  };

  test("calls the keep function once with the run's added messages in order, and appends its answer after the new messages", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const calls: (readonly Message[])[] = [];
    const answer: Message[] = [
      {
        role: "assistant",
        parts: [
          { type: "text", text: "Hello" },
          { type: "tool-call", id: "c1", name: "ask", arguments: {} },
        ],
      },
      T1,
    ];
    const entrance = createContinueConversation({
      run: fakeRunAppending(A1, T1, A2),
    });

    const outcome = await entrance(
      runConfig(fakeProvider().provider),
      {
        store,
        id: "t1",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
      {
        keep: (added) => {
          calls.push(added);
          return answer;
        },
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([A1, T1, A2]);
    expect(outcome.saved).toBe(true);
    if (!outcome.saved) throw new Error("unreachable");
    expect(outcome.entry).toEqual({
      messages: [{ role: "user", content: "hi" }, ...answer],
    });
    const slice = await store.read("t1", { kind: "all" });
    expect(slice.entries).toEqual([outcome.entry]);
  });

  test("does not append until the keep function's promise resolves, even though the run already finished", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    let resolveKeep!: (messages: Message[]) => void;
    const pending = new Promise<Message[]>((resolve) => {
      resolveKeep = resolve;
    });
    const entrance = createContinueConversation({
      run: fakeRunAppending(A1, T1, A2),
    });

    const promise = entrance(
      runConfig(fakeProvider().provider),
      {
        store,
        id: "t1",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
      { keep: () => pending },
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(
      (await store.read("t1", { kind: "all" })).entries,
    ).toHaveLength(0);

    resolveKeep([A1, T1, A2]);
    const outcome = await promise;

    expect(outcome.saved).toBe(true);
    expect(
      (await store.read("t1", { kind: "all" })).entries,
    ).toHaveLength(1);
  });

  test("does not append and reports not-in-result when the answer is not a shorter reply followed by the same text cut off", async () => {
    const { store, entrance, keep } = entranceWith(
      () => [
        { role: "assistant", parts: [{ type: "text", text: "Hi" }] },
      ],
      A1,
      T1,
      A2,
    );
    await store.create("t1");

    const outcome = await entrance(
      runConfig(fakeProvider().provider),
      {
        store,
        id: "t1",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
      { keep },
    );

    expect(outcome.saved).toBe(false);
    if (outcome.saved) throw new Error("unreachable");
    expect(outcome.reason).toEqual({ kind: "not-in-result" });
    expect(
      (await store.read("t1", { kind: "all" })).entries,
    ).toHaveLength(0);
  });

  test("does not append and reports not-in-result when the answer reorders the added messages", async () => {
    const { store, entrance, keep } = entranceWith(
      () => [T1, A1],
      A1,
      T1,
      A2,
    );
    await store.create("t1");

    const outcome = await entrance(
      runConfig(fakeProvider().provider),
      {
        store,
        id: "t1",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
      { keep },
    );

    if (outcome.saved) throw new Error("unreachable");
    expect(outcome.reason).toEqual({ kind: "not-in-result" });
  });

  test("does not append and reports not-in-result when the answer truncates a tool result", async () => {
    const { store, entrance, keep } = entranceWith(
      () => [A1, { role: "tool", toolCallId: "c1", content: "queued" }],
      A1,
      T1,
      A2,
    );
    await store.create("t1");

    const outcome = await entrance(
      runConfig(fakeProvider().provider),
      {
        store,
        id: "t1",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
      { keep },
    );

    if (outcome.saved) throw new Error("unreachable");
    expect(outcome.reason).toEqual({ kind: "not-in-result" });
  });

  test("does not append and reports not-in-result when the answer changes a tool call's arguments", async () => {
    const changedA1: Message = {
      role: "assistant",
      parts: [
        { type: "text", text: "Hello there." },
        {
          type: "tool-call",
          id: "c1",
          name: "ask",
          arguments: { x: 1 },
        },
      ],
    };
    const { store, entrance, keep } = entranceWith(
      () => [changedA1, T1, A2],
      A1,
      T1,
      A2,
    );
    await store.create("t1");

    const outcome = await entrance(
      runConfig(fakeProvider().provider),
      {
        store,
        id: "t1",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
      { keep },
    );

    if (outcome.saved) throw new Error("unreachable");
    expect(outcome.reason).toEqual({ kind: "not-in-result" });
  });

  test("does not append and reports not-in-result when the answer drops earlier text or drops a tool call", async () => {
    const droppedText: Message[] = [
      {
        role: "assistant",
        parts: [
          { type: "tool-call", id: "c1", name: "ask", arguments: {} },
        ],
      },
      T1,
      { role: "assistant", parts: [{ type: "text", text: "It is" }] },
    ];
    const droppedToolCall: Message[] = [
      {
        role: "assistant",
        parts: [{ type: "text", text: "Hello there." }],
      },
      T1,
      A2,
    ];

    for (const answer of [droppedText, droppedToolCall]) {
      const { store, entrance, keep } = entranceWith(
        () => answer,
        A1,
        T1,
        A2,
      );
      await store.create("t1");

      const outcome = await entrance(
        runConfig(fakeProvider().provider),
        {
          store,
          id: "t1",
          history: { kind: "all" },
          messages: [{ role: "user", content: "hi" }],
        },
        { keep },
      );

      if (outcome.saved) throw new Error("unreachable");
      expect(outcome.reason).toEqual({ kind: "not-in-result" });
      expect(
        (await store.read("t1", { kind: "all" })).entries,
      ).toHaveLength(0);
    }
  });

  test("does not append and reports keep-failed carrying the thrown error when the keep function rejects", async () => {
    const error = new Error("gone");
    const { store, entrance, keep } = entranceWith(
      () => {
        throw error;
      },
      A1,
      T1,
      A2,
    );
    await store.create("t1");

    const outcome = await entrance(
      runConfig(fakeProvider().provider),
      {
        store,
        id: "t1",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
      { keep },
    );

    expect(outcome.saved).toBe(false);
    if (outcome.saved) throw new Error("unreachable");
    expect(outcome.reason).toEqual({ kind: "keep-failed", error });
    expect(
      (await store.read("t1", { kind: "all" })).entries,
    ).toHaveLength(0);
  });

  test("never calls the keep function and reports diverged when the run's result does not start with what was sent", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const calls: (readonly Message[])[] = [];
    const entrance = createContinueConversation({
      run: async () => ({
        sessionId: "s1",
        result: {
          reason: "stop",
          messages: [{ role: "user", content: "HI" }, A1, T1, A2],
          usage: { inputTokens: 0, outputTokens: 0 },
        },
      }),
    });

    const outcome = await entrance(
      runConfig(fakeProvider().provider),
      {
        store,
        id: "t1",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
      {
        keep: (added) => {
          calls.push(added);
          return [];
        },
      },
    );

    expect(calls).toHaveLength(0);
    if (outcome.saved) throw new Error("unreachable");
    expect(outcome.reason).toEqual({ kind: "diverged" });
  });

  test("checks an empty answer by the same rule: rejected against three added messages, accepted and appending nothing extra when the run added only one", async () => {
    const store1 = createMemoryConversationStore();
    await store1.create("t1");
    const entrance1 = createContinueConversation({
      run: fakeRunAppending(A1, T1, A2),
    });

    const outcome1 = await entrance1(
      runConfig(fakeProvider().provider),
      {
        store: store1,
        id: "t1",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
      { keep: () => [] },
    );

    if (outcome1.saved) throw new Error("unreachable");
    expect(outcome1.reason).toEqual({ kind: "not-in-result" });
    expect(
      (await store1.read("t1", { kind: "all" })).entries,
    ).toHaveLength(0);

    const store2 = createMemoryConversationStore();
    await store2.create("t1");
    const entrance2 = createContinueConversation({
      run: fakeRunAppending(A2),
    });

    const outcome2 = await entrance2(
      runConfig(fakeProvider().provider),
      {
        store: store2,
        id: "t1",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
      { keep: () => [] },
    );

    expect(outcome2.saved).toBe(true);
    if (!outcome2.saved) throw new Error("unreachable");
    expect(outcome2.entry).toEqual({
      messages: [{ role: "user", content: "hi" }],
    });
  });

  test("appends everything the run added when no keep function is given", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const entrance = createContinueConversation({
      run: fakeRunAppending(A1, T1, A2),
    });

    const outcome = await entrance(runConfig(fakeProvider().provider), {
      store,
      id: "t1",
      history: { kind: "all" },
      messages: [{ role: "user", content: "hi" }],
    });

    expect(outcome.saved).toBe(true);
    if (!outcome.saved) throw new Error("unreachable");
    expect(outcome.entry).toEqual({
      messages: [{ role: "user", content: "hi" }, A1, T1, A2],
    });
  });

  test("accepts an answer produced by cutting the added messages at a delivered position, appending exactly that cut result", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const entrance = createContinueConversation({
      run: fakeRunAppending(A1, T1, A2),
    });

    const outcome = await entrance(
      runConfig(fakeProvider().provider),
      {
        store,
        id: "t1",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
      {
        keep: (added) =>
          keepDelivered(added, { kind: "until", turn: 1, end: 5 }),
      },
    );

    expect(outcome.saved).toBe(true);
    if (!outcome.saved) throw new Error("unreachable");
    expect(outcome.entry).toEqual({
      messages: [
        { role: "user", content: "hi" },
        A1,
        T1,
        { role: "assistant", parts: [{ type: "text", text: "It is" }] },
      ],
    });
  });

  test("accepts an answer that is written out to equal a cut result or the full added messages, without calling the cutting helper", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const entrance = createContinueConversation({
      run: fakeRunAppending(A1, T1, A2),
    });

    const cutAnswer: Message[] = [
      A1,
      T1,
      { role: "assistant", parts: [{ type: "text", text: "It is" }] },
    ];

    const outcome = await entrance(
      runConfig(fakeProvider().provider),
      {
        store,
        id: "t1",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
      { keep: () => cutAnswer },
    );

    expect(outcome.saved).toBe(true);
    if (!outcome.saved) throw new Error("unreachable");
    expect(outcome.entry).toEqual({
      messages: [{ role: "user", content: "hi" }, ...cutAnswer],
    });

    const store2 = createMemoryConversationStore();
    await store2.create("t1");
    const entrance2 = createContinueConversation({
      run: fakeRunAppending(A1, T1, A2),
    });

    const outcome2 = await entrance2(
      runConfig(fakeProvider().provider),
      {
        store: store2,
        id: "t1",
        history: { kind: "all" },
        messages: [{ role: "user", content: "hi" }],
      },
      { keep: () => [A1, T1, A2] },
    );

    expect(outcome2.saved).toBe(true);
    if (!outcome2.saved) throw new Error("unreachable");
    expect(outcome2.entry).toEqual({
      messages: [{ role: "user", content: "hi" }, A1, T1, A2],
    });
  });
});
