// oxlint-disable-next-line import/no-duplicates
import type { Message, Provider } from "@mg/core";
import type { Tool } from "@mg/core";
import { defineTool } from "@mg/core";
import { createMemoryConversationStore } from "@mg/conversation";
import type { ConversationStore } from "@mg/conversation";
import type {
  Persona,
  PersonaContext,
  Recall,
  RecallRequest,
  RememberOutcome,
  RememberRequest,
} from "@mg/persona";
import { TraceShutdownError } from "@mg/trace/otel";
import type {
  ReadableSpan,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import type { RunConfig } from "./config.js";
import type {
  ContinueOptions,
  ContinueOutcome,
  ConversationTarget,
} from "./continue-conversation.js";
import type { MemoryOutcome } from "./continue-as-persona.js";
import { createContinueAsPersona } from "./continue-as-persona.js";
import { createContinueConversation } from "./continue-conversation.js";
// oxlint-disable-next-line import/no-duplicates
import type { RunOptions } from "./run.js";
import type { RunOutcome } from "./run.js";

type FakeRead = { token: number };

const REPLY: Message = {
  role: "assistant",
  parts: [{ type: "text", text: "hi Alice" }],
};

const runConfig = (): RunConfig => ({
  name: "example",
  provider: {} as Provider,
  harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
});

const conversationTarget = (
  store: ConversationStore,
): ConversationTarget => ({
  store,
  id: "t1",
  history: { kind: "all" },
  messages: [{ role: "user", content: "hi" }],
});

type RecallCall = {
  request: RecallRequest<string>;
  context?: PersonaContext;
};

type RememberCall = {
  request: RememberRequest<FakeRead>;
  context?: PersonaContext;
};

const fakePersona = (options?: {
  recall?: () => Promise<Recall<FakeRead>>;
  remember?: (
    request: RememberRequest<FakeRead>,
    context?: PersonaContext,
  ) => Promise<RememberOutcome<FakeRead>>;
}): {
  persona: Persona<string, FakeRead>;
  recallCalls: RecallCall[];
  rememberCalls: RememberCall[];
} => {
  const recallCalls: RecallCall[] = [];
  const rememberCalls: RememberCall[] = [];
  return {
    persona: {
      id: "jev",
      recall: async (request, context) => {
        recallCalls.push({ request, context });
        if (options?.recall) return options.recall();
        return { instruction: "I am Jev.", read: { token: 1 } };
      },
      remember: async (request, context) => {
        rememberCalls.push({ request, context });
        if (options?.remember)
          return options.remember(request, context);
        throw new Error("fakePersona: remember is not scripted");
      },
    },
    recallCalls,
    rememberCalls,
  };
};

type FakeContinueCall = {
  config: RunConfig;
  conversation: ConversationTarget;
  options?: RunOptions;
};

const fakeContinueConversation = (
  impl?: (
    config: RunConfig,
    conversation: ConversationTarget,
    options?: RunOptions,
  ) => Promise<ContinueOutcome>,
): {
  continueConversation: (
    config: RunConfig,
    conversation: ConversationTarget,
    options?: RunOptions,
  ) => Promise<ContinueOutcome>;
  calls: FakeContinueCall[];
} => {
  const calls: FakeContinueCall[] = [];
  return {
    continueConversation: async (config, conversation, options) => {
      calls.push({ config, conversation, options });
      if (impl) return impl(config, conversation, options);
      return {
        saved: true,
        sessionId: options?.sessionId ?? "default",
        result: {
          reason: "stop",
          messages: [],
          usage: { inputTokens: 0, outputTokens: 0 },
        },
        entry: {
          messages: [
            { role: "system", content: "I am Jev." },
            { role: "user", content: "hi" },
            REPLY,
          ],
        },
      };
    },
    calls,
  };
};

type ExportResultCallback = Parameters<SpanExporter["export"]>[1];

class FlushFailingExporter implements SpanExporter {
  constructor(private readonly error: Error) {}

  export(
    _spans: ReadableSpan[],
    resultCallback: ExportResultCallback,
  ): void {
    resultCallback({ code: 0 });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.reject(this.error);
  }
}

describe("continueAsPersona", () => {
  test("recalls, runs the conversation with the instruction ahead of the new messages, and remembers what was saved", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const { persona, recallCalls, rememberCalls } = fakePersona({
      remember: async () => ({
        updated: true,
        added: ["n1"],
        personaChanged: false,
        forgotten: [],
      }),
    });
    const { continueConversation, calls } = fakeContinueConversation();
    const entrance = createContinueAsPersona({ continueConversation });
    const exporter = new InMemorySpanExporter();

    const outcome = await entrance(
      runConfig(),
      conversationTarget(store),
      {
        persona,
        counterparts: [{ id: "alice", name: "Alice" }],
        input: "hi",
        trace: { exporters: [exporter] },
      },
    );

    expect(recallCalls).toHaveLength(1);
    expect(recallCalls[0]?.request).toEqual({
      counterparts: [{ id: "alice", name: "Alice" }],
      conversation: "t1",
      input: "hi",
    });
    expect(recallCalls[0]?.context?.signal).toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.conversation).toEqual({
      store,
      id: "t1",
      history: { kind: "all" },
      messages: [
        { role: "system", content: "I am Jev." },
        { role: "user", content: "hi" },
      ],
    });
    expect(calls[0]?.options?.sessionId).toHaveLength(21);

    expect(rememberCalls).toHaveLength(1);
    expect(rememberCalls[0]?.request).toEqual({
      read: { token: 1 },
      entry: [
        { role: "system", content: "I am Jev." },
        { role: "user", content: "hi" },
        REPLY,
      ],
    });
    expect(rememberCalls[0]?.context?.signal).toBeUndefined();

    expect(outcome).toEqual({
      saved: true,
      sessionId: calls[0]?.options?.sessionId,
      result: {
        reason: "stop",
        messages: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      entry: {
        messages: [
          { role: "system", content: "I am Jev." },
          { role: "user", content: "hi" },
          REPLY,
        ],
      },
      personaSessionId: outcome.personaSessionId,
      referenced: true,
      recorded: { ok: true },
      memory: {
        updated: true,
        added: ["n1"],
        personaChanged: false,
        forgotten: [],
      },
    });
    expect(typeof outcome.personaSessionId).toBe("string");
  });

  test("forwards the wrap-up signal and the added tools through to the run function, saving the wrapped-up result and remembering it", async () => {
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
      messages: Message[],
      options?: RunOptions,
    ): Promise<RunOutcome> => {
      optionsSeen.push(options);
      return {
        sessionId: options?.sessionId ?? "unexpected",
        result: {
          reason: "wrapped-up",
          messages: [
            ...messages,
            {
              role: "assistant",
              parts: [{ type: "text", text: "Hel" }],
            },
          ],
          usage: { inputTokens: 0, outputTokens: 0 },
        },
      };
    };
    const { persona } = fakePersona({
      remember: async () => ({
        updated: true,
        added: ["n1"],
        personaChanged: false,
        forgotten: [],
      }),
    });
    const entrance = createContinueAsPersona({
      continueConversation: createContinueConversation({
        run: fakeRun,
      }),
    });

    const outcome = await entrance(
      runConfig(),
      conversationTarget(store),
      {
        persona,
        counterparts: [{ id: "alice", name: "Alice" }],
        input: "hi",
        trace: { exporters: [new InMemorySpanExporter()] },
      },
      { wrapUp: controller.signal, tools: [askTool] },
    );

    expect(optionsSeen[0]?.wrapUp).toBe(controller.signal);
    expect(optionsSeen[0]?.tools).toEqual([askTool]);
    expect(outcome.saved).toBe(true);
    expect(outcome.referenced).toBe(true);
    expect(outcome.result.reason).toBe("wrapped-up");
    if (!outcome.saved) throw new Error("unreachable");
    expect(outcome.entry.messages).toEqual([
      { role: "system", content: "I am Jev." },
      { role: "user", content: "hi" },
      { role: "assistant", parts: [{ type: "text", text: "Hel" }] },
    ]);
    expect(outcome.memory).toEqual({
      updated: true,
      added: ["n1"],
      personaChanged: false,
      forgotten: [],
    });
  });

  test("records a persona span carrying the id, conversation, counterparts, run session, and outcome flags", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const { persona } = fakePersona({
      remember: async () => ({
        updated: true,
        added: ["n1"],
        personaChanged: false,
        forgotten: [],
      }),
    });
    const { continueConversation, calls } = fakeContinueConversation();
    const entrance = createContinueAsPersona({ continueConversation });
    const exporter = new InMemorySpanExporter();

    await entrance(
      runConfig(),
      conversationTarget(store),
      {
        persona,
        counterparts: [{ id: "alice", name: "Alice" }],
        input: "hi",
        trace: { exporters: [exporter] },
      },
      { sessionId: "s9" },
    );

    const spans = exporter
      .getFinishedSpans()
      .filter((span) => span.name === "mg.persona");
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span?.attributes["mg.op"]).toBe("persona");
    expect(span?.attributes["mg.persona.id"]).toBe("jev");
    expect(span?.attributes["mg.persona.conversation"]).toBe("t1");
    expect(span?.attributes["mg.persona.counterparts"]).toBe(
      JSON.stringify(["alice"]),
    );
    expect(span?.attributes["mg.run.session"]).toBe("s9");
    expect(span?.attributes["mg.persona.referenced"]).toBe(true);
    expect(span?.attributes["mg.persona.saved"]).toBe(true);
    expect(span?.attributes["mg.persona.updated"]).toBe(true);
    expect(calls[0]?.options?.sessionId).toBe("s9");
  });

  test("passes the same signal to recall, the conversation entrance, and remember", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const controller = new AbortController();
    const { persona, recallCalls, rememberCalls } = fakePersona({
      remember: async () => ({
        updated: true,
        added: ["n1"],
        personaChanged: false,
        forgotten: [],
      }),
    });
    const { continueConversation, calls } = fakeContinueConversation();
    const entrance = createContinueAsPersona({ continueConversation });

    await entrance(
      runConfig(),
      conversationTarget(store),
      {
        persona,
        counterparts: [{ id: "alice", name: "Alice" }],
        input: "hi",
        trace: { exporters: [new InMemorySpanExporter()] },
      },
      { signal: controller.signal },
    );

    expect(recallCalls[0]?.context?.signal).toBe(controller.signal);
    expect(calls[0]?.options?.signal).toBe(controller.signal);
    expect(rememberCalls[0]?.context?.signal).toBe(controller.signal);
  });

  test("reports a lost reference and the expected session id when the run returns a different session", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const { persona } = fakePersona({
      remember: async () => ({
        updated: true,
        added: [],
        personaChanged: false,
        forgotten: [],
      }),
    });
    const { continueConversation } = fakeContinueConversation(
      async (_config, _conversation, _options) => ({
        saved: true,
        sessionId: "other",
        result: {
          reason: "stop",
          messages: [],
          usage: { inputTokens: 0, outputTokens: 0 },
        },
        entry: {
          messages: [
            { role: "system", content: "I am Jev." },
            { role: "user", content: "hi" },
            REPLY,
          ],
        },
      }),
    );
    const entrance = createContinueAsPersona({ continueConversation });
    const exporter = new InMemorySpanExporter();

    const outcome = await entrance(
      runConfig(),
      conversationTarget(store),
      {
        persona,
        counterparts: [{ id: "alice", name: "Alice" }],
        input: "hi",
        trace: { exporters: [exporter] },
      },
    );

    expect(outcome.referenced).toBe(false);
    if (outcome.referenced) throw new Error("unreachable");
    expect(outcome.expectedRunSessionId).toHaveLength(21);

    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === "mg.persona");
    expect(span?.attributes["mg.persona.referenced"]).toBe(false);
  });

  test("does not remember and leaves memory out of the outcome when the conversation was not saved", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const { persona, rememberCalls } = fakePersona();
    const { continueConversation } = fakeContinueConversation(
      async (_config, _conversation, options) => ({
        saved: false,
        sessionId: options?.sessionId ?? "s1",
        result: {
          reason: "stop",
          messages: [],
          usage: { inputTokens: 0, outputTokens: 0 },
        },
        reason: { kind: "diverged" },
      }),
    );
    const entrance = createContinueAsPersona({ continueConversation });
    const exporter = new InMemorySpanExporter();

    const outcome = await entrance(
      runConfig(),
      conversationTarget(store),
      {
        persona,
        counterparts: [{ id: "alice", name: "Alice" }],
        input: "hi",
        trace: { exporters: [exporter] },
      },
    );

    expect(rememberCalls).toHaveLength(0);
    expect(outcome).toEqual({
      saved: false,
      sessionId: outcome.sessionId,
      result: {
        reason: "stop",
        messages: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      reason: { kind: "diverged" },
      personaSessionId: outcome.personaSessionId,
      referenced: true,
      recorded: { ok: true },
    });
    expect(Object.hasOwn(outcome, "memory")).toBe(false);

    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === "mg.persona");
    expect(span?.attributes["mg.persona.saved"]).toBe(false);
    expect(span?.attributes["mg.persona.updated"]).toBeUndefined();
  });

  test("rejects with the abort reason and never recalls or records when the signal is already aborted", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const { persona, recallCalls } = fakePersona();
    const { continueConversation } = fakeContinueConversation();
    const entrance = createContinueAsPersona({ continueConversation });
    const exporter = new InMemorySpanExporter();
    const controller = new AbortController();
    const reason = new Error("stop");
    controller.abort(reason);

    await expect(
      entrance(
        runConfig(),
        conversationTarget(store),
        {
          persona,
          counterparts: [{ id: "alice", name: "Alice" }],
          input: "hi",
          trace: { exporters: [exporter] },
        },
        { signal: controller.signal },
      ),
    ).rejects.toBe(reason);

    expect(recallCalls).toHaveLength(0);
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  test("rejects with recall's own error, never runs the conversation, and ends the persona span with it", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const error = new Error("no memory");
    const { persona } = fakePersona({
      recall: async () => {
        throw error;
      },
    });
    const { continueConversation, calls } = fakeContinueConversation();
    const entrance = createContinueAsPersona({ continueConversation });
    const exporter = new InMemorySpanExporter();

    await expect(
      entrance(runConfig(), conversationTarget(store), {
        persona,
        counterparts: [{ id: "alice", name: "Alice" }],
        input: "hi",
        trace: { exporters: [exporter] },
      }),
    ).rejects.toBe(error);

    expect(calls).toHaveLength(0);
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === "mg.persona");
    expect(span?.status.code).toBe(2);
  });

  test("rejects with the conversation entrance's own error, never remembers, and ends the persona span with it", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const error = new Error("run failed");
    const { persona, rememberCalls } = fakePersona();
    const { continueConversation } = fakeContinueConversation(
      async () => {
        throw error;
      },
    );
    const entrance = createContinueAsPersona({ continueConversation });
    const exporter = new InMemorySpanExporter();

    await expect(
      entrance(runConfig(), conversationTarget(store), {
        persona,
        counterparts: [{ id: "alice", name: "Alice" }],
        input: "hi",
        trace: { exporters: [exporter] },
      }),
    ).rejects.toBe(error);

    expect(rememberCalls).toHaveLength(0);
    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === "mg.persona");
    expect(span?.status.code).toBe(2);
  });

  test("carries a write-failed memory outcome through while keeping saved true and recording updated as false", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const conflict = new Error("conflict");
    const memoryOutcome: MemoryOutcome<FakeRead> = {
      updated: false,
      reason: "write-failed",
      error: conflict,
    };
    const { persona } = fakePersona({
      remember: async () => memoryOutcome,
    });
    const { continueConversation } = fakeContinueConversation();
    const entrance = createContinueAsPersona({ continueConversation });
    const exporter = new InMemorySpanExporter();

    const outcome = await entrance(
      runConfig(),
      conversationTarget(store),
      {
        persona,
        counterparts: [{ id: "alice", name: "Alice" }],
        input: "hi",
        trace: { exporters: [exporter] },
      },
    );

    if (!outcome.saved) throw new Error("unreachable");
    expect(outcome.memory).toEqual(memoryOutcome);

    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === "mg.persona");
    expect(span?.attributes["mg.persona.updated"]).toBe(false);
  });

  test("resolves with a rejected memory outcome carrying remember's error, without rejecting the entrance itself", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const bug = new Error("bug");
    const { persona } = fakePersona({
      remember: async () => {
        throw bug;
      },
    });
    const { continueConversation } = fakeContinueConversation();
    const entrance = createContinueAsPersona({ continueConversation });
    const exporter = new InMemorySpanExporter();

    const outcome = await entrance(
      runConfig(),
      conversationTarget(store),
      {
        persona,
        counterparts: [{ id: "alice", name: "Alice" }],
        input: "hi",
        trace: { exporters: [exporter] },
      },
    );

    expect(outcome.saved).toBe(true);
    if (!outcome.saved) throw new Error("unreachable");
    expect(outcome.memory).toEqual({
      updated: false,
      reason: "rejected",
      error: bug,
    });

    const span = exporter
      .getFinishedSpans()
      .find((s) => s.name === "mg.persona");
    expect(span?.status.code).toBe(2);
    expect(span?.attributes["mg.persona.updated"]).toBe(false);
  });

  test("carries a failed-to-record outcome without rejecting when the conversation was saved", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const diskError = new Error("disk");
    const { persona } = fakePersona({
      remember: async () => ({
        updated: true,
        added: [],
        personaChanged: false,
        forgotten: [],
      }),
    });
    const { continueConversation } = fakeContinueConversation();
    const entrance = createContinueAsPersona({ continueConversation });

    const outcome = await entrance(
      runConfig(),
      conversationTarget(store),
      {
        persona,
        counterparts: [{ id: "alice", name: "Alice" }],
        input: "hi",
        trace: { exporters: [new FlushFailingExporter(diskError)] },
      },
    );

    expect(outcome.saved).toBe(true);
    expect(outcome.recorded.ok).toBe(false);
    if (outcome.recorded.ok) throw new Error("unreachable");
    expect(outcome.recorded.error).toBeInstanceOf(TraceShutdownError);
    const shutdownError = outcome.recorded.error as TraceShutdownError;
    expect(shutdownError.failures).toEqual([
      { target: "exporters[0]", step: "flush", error: diskError },
    ]);
  });

  test("rejects with recall's error, not the recording failure, when both the recall and the write-out fail", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const recallError = new Error("no memory");
    const diskError = new Error("disk");
    const { persona } = fakePersona({
      recall: async () => {
        throw recallError;
      },
    });
    const { continueConversation } = fakeContinueConversation();
    const entrance = createContinueAsPersona({ continueConversation });

    await expect(
      entrance(runConfig(), conversationTarget(store), {
        persona,
        counterparts: [{ id: "alice", name: "Alice" }],
        input: "hi",
        trace: { exporters: [new FlushFailingExporter(diskError)] },
      }),
    ).rejects.toBe(recallError);
  });

  test("rejects with the conversation entrance's error, not the recording failure, when both the run and the write-out fail", async () => {
    const store = createMemoryConversationStore();
    await store.create("t1");
    const runError = new Error("run failed");
    const diskError = new Error("disk");
    const { persona } = fakePersona();
    const { continueConversation } = fakeContinueConversation(
      async () => {
        throw runError;
      },
    );
    const entrance = createContinueAsPersona({ continueConversation });

    await expect(
      entrance(runConfig(), conversationTarget(store), {
        persona,
        counterparts: [{ id: "alice", name: "Alice" }],
        input: "hi",
        trace: { exporters: [new FlushFailingExporter(diskError)] },
      }),
    ).rejects.toBe(runError);
  });
});

describe("continueAsPersona with a keep function", () => {
  test("forwards the keep function to the conversation entrance, and remembers the entry it kept", async () => {
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

    const store = createMemoryConversationStore();
    await store.create("t1");
    const { persona, rememberCalls } = fakePersona({
      remember: async () => ({
        updated: true,
        added: [],
        personaChanged: false,
        forgotten: [],
      }),
    });
    const continueConversation = createContinueConversation({
      run: async (_config: RunConfig, messages: Message[]) => ({
        sessionId: "s1",
        result: {
          reason: "stop" as const,
          messages: [...messages, A1, T1, A2],
          usage: { inputTokens: 0, outputTokens: 0 },
        },
      }),
    });
    const entrance = createContinueAsPersona({ continueConversation });
    const keep: ContinueOptions["keep"] = () => answer;

    await entrance(
      runConfig(),
      conversationTarget(store),
      {
        persona,
        counterparts: [{ id: "alice", name: "Alice" }],
        input: "hi",
        trace: { exporters: [new InMemorySpanExporter()] },
      },
      { keep },
    );

    expect(rememberCalls).toHaveLength(1);
    expect(rememberCalls[0]?.request.entry).toEqual([
      { role: "system", content: "I am Jev." },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        parts: [
          { type: "text", text: "Hello" },
          { type: "tool-call", id: "c1", name: "ask", arguments: {} },
        ],
      },
      T1,
    ]);
  });
});
