import { describe, expect, it } from "vitest";
import {
  assistantMessage,
  createOllamaProvider,
  createOpenRouterProvider,
  createRetryingProvider,
  type GenerateRequest,
  type GenerateResponse,
  type Message,
  type Provider,
  type StreamEvent,
  type ToolForcingProvider,
  ProviderRequestError,
} from "@mg/core";
import { ATTR, EVENT, SPAN } from "./vocabulary.js";
import {
  STREAM_INCOMPLETE_MESSAGE,
  traceProvider,
} from "./provider.js";
import { sentMessagesOf } from "./sent-messages.js";
import { RecordingSpan } from "./recording-span.test-helper.js";

const request: GenerateRequest = {
  model: "test-model",
  messages: [{ role: "user", content: "hi" }],
};

describe("traceProvider / generate", () => {
  it("records model, stream flag and input messages before calling the provider", async () => {
    const root = new RecordingSpan("root");
    let startedBefore: RecordingSpan | undefined;
    const provider: Provider = {
      toolForcing: true,
      generate: async () => {
        startedBefore = root.children[0];
        return {
          parts: [{ type: "text", text: "hello" }],
          finishReason: "stop",
        };
      },
      stream: async function* () {},
    };

    await traceProvider(provider, root).generate(request);

    expect(startedBefore?.name).toBe(SPAN.llm);
    expect(startedBefore?.attributes).toEqual({
      [ATTR.op]: "llm",
      [ATTR.llmModel]: "test-model",
      [ATTR.llmStream]: false,
      [ATTR.llmInputMessages]: JSON.stringify(request.messages),
      [ATTR.llmSystemCount]: 0,
    });
  });

  it("records finish reason, output messages and returns the response unchanged", async () => {
    const root = new RecordingSpan("root");
    const response: GenerateResponse = {
      parts: [
        { type: "text", text: "hello there" },
        { type: "tool-call", id: "1", name: "x", arguments: {} },
      ],
      finishReason: "stop",
      usage: { inputTokens: 3, outputTokens: 5 },
    };
    const provider: Provider = {
      toolForcing: true,
      generate: async () => response,
      stream: async function* () {},
    };

    const result = await traceProvider(provider, root).generate(
      request,
    );
    const span = root.children[0];

    expect(result).toBe(response);
    expect(span?.mergedAttributes[ATTR.llmFinishReason]).toBe("stop");
    expect(span?.mergedAttributes[ATTR.llmInputTokens]).toBe(3);
    expect(span?.mergedAttributes[ATTR.llmOutputTokens]).toBe(5);
    expect(span?.mergedAttributes[ATTR.llmOutputMessages]).toBe(
      JSON.stringify([assistantMessage(response.parts)]),
    );
    expect(span?.endCalls).toEqual([undefined]);
  });

  it("omits token attributes when usage is absent", async () => {
    const root = new RecordingSpan("root");
    const provider: Provider = {
      toolForcing: true,
      generate: async () => ({
        parts: [{ type: "text", text: "no usage" }],
        finishReason: "stop",
      }),
      stream: async function* () {},
    };

    await traceProvider(provider, root).generate(request);
    const span = root.children[0];

    expect(span?.mergedAttributes[ATTR.llmInputTokens]).toBeUndefined();
    expect(
      span?.mergedAttributes[ATTR.llmOutputTokens],
    ).toBeUndefined();
  });

  it("writes reasoning parts to the output message in order alongside text and tool calls", async () => {
    const root = new RecordingSpan("root");
    const response: GenerateResponse = {
      parts: [
        { type: "reasoning", text: "thinking" },
        { type: "text", text: "hello" },
        { type: "tool-call", id: "1", name: "x", arguments: {} },
      ],
      finishReason: "stop",
    };
    const provider: Provider = {
      toolForcing: true,
      generate: async () => response,
      stream: async function* () {},
    };

    await traceProvider(provider, root).generate(request);
    const span = root.children[0];

    expect(span?.mergedAttributes[ATTR.llmOutputMessages]).toBe(
      JSON.stringify([assistantMessage(response.parts)]),
    );
  });

  it("strips carry from reasoning parts without mutating the request or the response", async () => {
    const root = new RecordingSpan("root");
    const historyMessages: Message[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        parts: [
          {
            type: "reasoning",
            text: "earlier thinking",
            carry: { provider: "openrouter", data: { a: 1 } },
          },
        ],
      },
    ];
    const reqWithHistory: GenerateRequest = {
      model: "test-model",
      messages: historyMessages,
    };
    const response: GenerateResponse = {
      parts: [
        {
          type: "reasoning",
          text: "more thinking",
          carry: { provider: "openrouter", data: { b: 2 } },
        },
        { type: "text", text: "hello" },
      ],
      finishReason: "stop",
    };
    const provider: Provider = {
      toolForcing: true,
      generate: async () => response,
      stream: async function* () {},
    };

    const result = await traceProvider(provider, root).generate(
      reqWithHistory,
    );
    const span = root.children[0];

    expect(result).toBe(response);
    expect(reqWithHistory.messages).toEqual(historyMessages);
    expect(reqWithHistory.messages[1]).toEqual({
      role: "assistant",
      parts: [
        {
          type: "reasoning",
          text: "earlier thinking",
          carry: { provider: "openrouter", data: { a: 1 } },
        },
      ],
    });

    expect(span?.attributes[ATTR.llmInputMessages]).not.toContain(
      "carry",
    );
    expect(
      span?.mergedAttributes[ATTR.llmOutputMessages],
    ).not.toContain("carry");
    expect(span?.mergedAttributes[ATTR.llmOutputMessages]).toBe(
      JSON.stringify([
        assistantMessage([
          { type: "reasoning", text: "more thinking" },
          { type: "text", text: "hello" },
        ]),
      ]),
    );
  });

  it("ends the span with the error and rethrows it unchanged when the provider throws", async () => {
    const root = new RecordingSpan("root");
    const error = new Error("boom");
    const provider: Provider = {
      toolForcing: true,
      generate: async () => {
        throw error;
      },
      stream: async function* () {},
    };

    await expect(
      traceProvider(provider, root).generate(request),
    ).rejects.toBe(error);

    const span = root.children[0];
    expect(span?.endCalls).toEqual([error]);
  });

  it("starts no span until generate is called", () => {
    const root = new RecordingSpan("root");
    const provider: Provider = {
      toolForcing: true,
      generate: async () => ({
        parts: [],
        finishReason: "stop",
      }),
      stream: async function* () {},
    };

    traceProvider(provider, root);

    expect(root.children).toHaveLength(0);
  });
});

const collect = async (
  iterable: AsyncIterable<StreamEvent>,
): Promise<StreamEvent[]> => {
  const events: StreamEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
};

describe("traceProvider / stream", () => {
  const streamEvents: StreamEvent[] = [
    { type: "text-delta", delta: "hel" },
    { type: "text-delta", delta: "lo" },
    {
      type: "tool-call",
      toolCall: { id: "1", name: "x", arguments: { a: 1 } },
    },
    {
      type: "finish",
      finishReason: "tool_calls",
      usage: { inputTokens: 2, outputTokens: 4 },
    },
  ];

  it("forwards every event unchanged and in order", async () => {
    const root = new RecordingSpan("root");
    const provider: Provider = {
      toolForcing: true,
      generate: async () => {
        throw new Error("unused");
      },
      stream: async function* () {
        for (const event of streamEvents) {
          yield event;
        }
      },
    };

    const events = await collect(
      traceProvider(provider, root).stream(request),
    );

    expect(events).toEqual(streamEvents);
  });

  it("records stream=true, and after completion the accumulated output and tokens", async () => {
    const root = new RecordingSpan("root");
    const provider: Provider = {
      toolForcing: true,
      generate: async () => {
        throw new Error("unused");
      },
      stream: async function* () {
        for (const event of streamEvents) {
          yield event;
        }
      },
    };

    await collect(traceProvider(provider, root).stream(request));
    const span = root.children[0];

    expect(span?.name).toBe(SPAN.llm);
    expect(span?.attributes[ATTR.llmStream]).toBe(true);
    expect(span?.mergedAttributes[ATTR.llmFinishReason]).toBe(
      "tool_calls",
    );
    expect(span?.mergedAttributes[ATTR.llmInputTokens]).toBe(2);
    expect(span?.mergedAttributes[ATTR.llmOutputTokens]).toBe(4);
    expect(span?.mergedAttributes[ATTR.llmOutputMessages]).toBe(
      JSON.stringify([
        assistantMessage([
          { type: "text", text: "hello" },
          {
            type: "tool-call",
            id: "1",
            name: "x",
            arguments: { a: 1 },
          },
        ]),
      ]),
    );
    expect(span?.endCalls).toEqual([undefined]);
  });

  it("accumulates reasoning, text and tool-call deltas into parts, keeping order, and strips carry", async () => {
    const root = new RecordingSpan("root");
    const interleaved: StreamEvent[] = [
      {
        type: "reasoning-delta",
        delta: "think",
        carry: { provider: "openrouter", data: { step: 1 } },
      },
      {
        type: "reasoning-delta",
        delta: "ing",
        carry: { provider: "openrouter", data: { step: 2 } },
      },
      { type: "text-delta", delta: "hel" },
      { type: "text-delta", delta: "lo" },
      {
        type: "tool-call",
        toolCall: { id: "1", name: "x", arguments: { a: 1 } },
      },
      {
        type: "finish",
        finishReason: "tool_calls",
        usage: { inputTokens: 2, outputTokens: 4 },
      },
    ];
    const provider: Provider = {
      toolForcing: true,
      generate: async () => {
        throw new Error("unused");
      },
      stream: async function* () {
        for (const event of interleaved) {
          yield event;
        }
      },
    };

    await collect(traceProvider(provider, root).stream(request));
    const span = root.children[0];

    expect(span?.mergedAttributes[ATTR.llmOutputMessages]).toBe(
      JSON.stringify([
        assistantMessage([
          { type: "reasoning", text: "thinking" },
          { type: "text", text: "hello" },
          {
            type: "tool-call",
            id: "1",
            name: "x",
            arguments: { a: 1 },
          },
        ]),
      ]),
    );
    expect(
      span?.mergedAttributes[ATTR.llmOutputMessages],
    ).not.toContain("carry");
  });

  it("ends the span with the error and rethrows it when the inner iterable throws mid-way", async () => {
    const root = new RecordingSpan("root");
    const error = new Error("stream boom");
    const provider: Provider = {
      toolForcing: true,
      generate: async () => {
        throw new Error("unused");
      },
      stream: async function* () {
        yield streamEvents[0];
        throw error;
      },
    };

    await expect(
      collect(traceProvider(provider, root).stream(request)),
    ).rejects.toBe(error);

    const span = root.children[0];
    expect(span?.endCalls).toEqual([error]);
  });

  it("closes the inner iterator and ends the span when the consumer stops early", async () => {
    const root = new RecordingSpan("root");
    let returned = false;
    const provider: Provider = {
      toolForcing: true,
      generate: async () => {
        throw new Error("unused");
      },
      stream: async function* () {
        try {
          for (const event of streamEvents) {
            yield event;
          }
        } finally {
          returned = true;
        }
      },
    };

    const iterable = traceProvider(provider, root).stream(request);
    for await (const event of iterable) {
      expect(event).toEqual(streamEvents[0]);
      break;
    }

    expect(returned).toBe(true);
    const span = root.children[0];
    expect(span?.endCalls).toEqual([undefined]);
  });

  it("ends the span with a stream-incomplete error when the inner iterable ends without a finish event", async () => {
    const root = new RecordingSpan("root");
    const provider: Provider = {
      toolForcing: true,
      generate: async () => {
        throw new Error("unused");
      },
      stream: async function* () {
        yield {
          type: "text-delta",
          delta: "hel",
        } satisfies StreamEvent;
        yield { type: "text-delta", delta: "lo" } satisfies StreamEvent;
      },
    };

    const events = await collect(
      traceProvider(provider, root).stream(request),
    );

    expect(events).toEqual([
      { type: "text-delta", delta: "hel" },
      { type: "text-delta", delta: "lo" },
    ]);

    const span = root.children[0];
    expect(span?.endCalls).toHaveLength(1);
    const error = span?.endCalls[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(STREAM_INCOMPLETE_MESSAGE);

    expect(
      span?.mergedAttributes[ATTR.llmFinishReason],
    ).toBeUndefined();
    expect(span?.mergedAttributes[ATTR.llmInputTokens]).toBeUndefined();
    expect(
      span?.mergedAttributes[ATTR.llmOutputTokens],
    ).toBeUndefined();
    expect(span?.mergedAttributes[ATTR.llmOutputMessages]).toBe(
      JSON.stringify([
        assistantMessage([{ type: "text", text: "hello" }]),
      ]),
    );
  });

  it("starts no span until iteration begins", () => {
    const root = new RecordingSpan("root");
    const provider: Provider = {
      toolForcing: true,
      generate: async () => {
        throw new Error("unused");
      },
      stream: async function* () {
        for (const event of streamEvents) {
          yield event;
        }
      },
    };

    traceProvider(provider, root).stream(request);

    expect(root.children).toHaveLength(0);
  });
});

describe("traceProvider / provider name", () => {
  const providerOf = (name?: string): Provider => ({
    ...(name !== undefined ? { name } : {}),
    toolForcing: true,
    generate: async () => ({
      parts: [{ type: "text", text: "hello" }],
      finishReason: "stop",
    }),
    stream: async function* () {},
  });

  it("keeps the wrapped provider's name", () => {
    const root = new RecordingSpan("root");

    expect(traceProvider(providerOf("openrouter"), root).name).toBe(
      "openrouter",
    );
  });

  it("has no name when the wrapped provider has none", () => {
    const root = new RecordingSpan("root");

    expect(
      traceProvider(providerOf(undefined), root).name,
    ).toBeUndefined();
  });

  it("sets mg.llm.provider on the span when the provider has a name", async () => {
    const root = new RecordingSpan("root");

    await traceProvider(providerOf("openrouter"), root).generate(
      request,
    );

    const span = root.children[0];
    expect(span?.attributes[ATTR.llmProvider]).toBe("openrouter");
  });

  it("omits mg.llm.provider from the span when the provider has no name", async () => {
    const root = new RecordingSpan("root");

    await traceProvider(providerOf(undefined), root).generate(request);

    const span = root.children[0];
    expect(span?.attributes[ATTR.llmProvider]).toBeUndefined();
    expect(ATTR.llmProvider in (span?.attributes ?? {})).toBe(false);
  });
});

describe("traceProvider / system messages", () => {
  const messages: Message[] = [
    { role: "system", content: "s0" },
    { role: "user", content: "hi" },
    { role: "system", content: "s2" },
    { role: "user", content: "again" },
  ];
  const expectedEvents = [
    {
      name: EVENT.llmSystem,
      attributes: {
        [ATTR.llmSystemContent]: "s0",
        [ATTR.llmSystemIndex]: 0,
      },
    },
    {
      name: EVENT.llmSystem,
      attributes: {
        [ATTR.llmSystemContent]: "s2",
        [ATTR.llmSystemIndex]: 2,
      },
    },
  ];
  const expectedInput = JSON.stringify([
    { role: "user", content: "hi" },
    { role: "user", content: "again" },
  ]);

  type Seen = {
    attributes: Record<string, unknown>;
    events: { name: string; attributes?: Record<string, unknown> }[];
  };
  const snapshot = (span: RecordingSpan | undefined): Seen => ({
    attributes: { ...span?.mergedAttributes },
    events: [...(span?.events ?? [])],
  });

  it("generate records system messages as events before the provider is called", async () => {
    const root = new RecordingSpan("root");
    let seen: Seen | undefined;
    const provider: Provider = {
      toolForcing: true,
      generate: async () => {
        seen = snapshot(root.children[0]);
        return { parts: [], finishReason: "stop" };
      },
      stream: async function* () {},
    };

    await traceProvider(provider, root).generate({
      model: "m",
      messages,
    });

    expect(seen?.attributes[ATTR.llmInputMessages]).toBe(expectedInput);
    expect(seen?.attributes[ATTR.llmSystemCount]).toBe(2);
    expect(seen?.events).toEqual(expectedEvents);
    expect(sentMessagesOf(seen as Seen)).toEqual({
      kind: "messages",
      messages,
    });
  });

  it("records count 0 and no events when no system message is sent", async () => {
    const root = new RecordingSpan("root");
    let seen: Seen | undefined;
    const provider: Provider = {
      toolForcing: true,
      generate: async () => {
        seen = snapshot(root.children[0]);
        return { parts: [], finishReason: "stop" };
      },
      stream: async function* () {},
    };

    await traceProvider(provider, root).generate(request);

    expect(seen?.attributes[ATTR.llmSystemCount]).toBe(0);
    expect(seen?.events).toEqual([]);
    expect(seen?.attributes[ATTR.llmInputMessages]).toBe(
      JSON.stringify([{ role: "user", content: "hi" }]),
    );
  });

  it("stream records the same system events and forwards events unchanged", async () => {
    const root = new RecordingSpan("root");
    let seen: Seen | undefined;
    const streamEvents: StreamEvent[] = [
      { type: "text-delta", delta: "a" },
      { type: "finish", finishReason: "stop" },
    ];
    const provider: Provider = {
      toolForcing: true,
      generate: async () => {
        throw new Error("unused");
      },
      stream: async function* () {
        seen = snapshot(root.children[0]);
        for (const event of streamEvents) yield event;
      },
    };

    const out: StreamEvent[] = [];
    for await (const event of traceProvider(provider, root).stream({
      model: "m",
      messages,
    })) {
      out.push(event);
    }

    expect(out).toEqual(streamEvents);
    expect(seen?.attributes[ATTR.llmStream]).toBe(true);
    expect(seen?.attributes[ATTR.llmInputMessages]).toBe(expectedInput);
    expect(seen?.attributes[ATTR.llmSystemCount]).toBe(2);
    expect(seen?.events).toEqual(expectedEvents);
  });
});

describe("traceProvider / tool-call carry and omissions", () => {
  const carry = { provider: "openrouter", data: { id: "call_1" } };
  const bare = {
    type: "tool-call",
    id: "u1",
    name: "echo",
    arguments: { text: "ping" },
  } as const;
  const part = { ...bare, carry };

  const generating = (response: GenerateResponse): Provider => ({
    toolForcing: true,
    generate: async () => response,
    stream: async function* () {},
  });
  const streaming = (events: StreamEvent[]): Provider => ({
    toolForcing: true,
    generate: async () => {
      throw new Error("unused");
    },
    stream: async function* () {
      for (const event of events) {
        yield event;
      }
    },
  });
  const drain = async (
    iterable: AsyncIterable<StreamEvent>,
  ): Promise<StreamEvent[]> => {
    const events: StreamEvent[] = [];
    for await (const event of iterable) {
      events.push(event);
    }
    return events;
  };

  it("records input tool-call parts without carry and leaves the request unchanged", async () => {
    const root = new RecordingSpan("root");
    const messages: Message[] = [
      { role: "user", content: "hi" },
      assistantMessage([part]),
      { role: "tool", toolCallId: "u1", content: "pong" },
    ];

    await traceProvider(
      generating({ parts: [], finishReason: "stop" }),
      root,
    ).generate({ model: "test-model", messages });

    const recorded = JSON.parse(
      String(root.children[0]?.attributes[ATTR.llmInputMessages]),
    );
    expect(recorded[1]).toEqual(assistantMessage([bare]));
    expect(messages[1]).toEqual(assistantMessage([part]));
  });

  it("generate records output tool-call parts without carry and returns the carry", async () => {
    const root = new RecordingSpan("root");

    const response = await traceProvider(
      generating({ parts: [part], finishReason: "tool_calls" }),
      root,
    ).generate(request);

    const recorded = JSON.parse(
      String(
        root.children[0]?.mergedAttributes[ATTR.llmOutputMessages],
      ),
    );
    expect(recorded[0]).toEqual(assistantMessage([bare]));
    expect(response.parts).toEqual([part]);
  });

  it("stream records output tool-call parts without carry and yields the carry", async () => {
    const root = new RecordingSpan("root");
    const events: StreamEvent[] = [
      {
        type: "tool-call",
        toolCall: {
          id: "u1",
          name: "echo",
          arguments: { text: "ping" },
        },
        carry,
      },
      { type: "finish", finishReason: "tool_calls" },
    ];

    const received = await drain(
      traceProvider(streaming(events), root).stream(request),
    );

    const recorded = JSON.parse(
      String(
        root.children[0]?.mergedAttributes[ATTR.llmOutputMessages],
      ),
    );
    expect(recorded[0]).toEqual(assistantMessage([bare]));
    expect(received).toEqual(events);
  });

  it("generate records the omissions the response lists", async () => {
    const root = new RecordingSpan("root");

    await traceProvider(
      generating({
        parts: [],
        finishReason: "stop",
        omitted: [
          { kind: "outside-tool-call-id", toolCallIds: ["u1", "u2"] },
        ],
      }),
      root,
    ).generate(request);

    expect(root.children[0]?.mergedAttributes[ATTR.llmOmitted]).toBe(
      '[{"kind":"outside-tool-call-id","toolCallIds":["u1","u2"]}]',
    );
  });

  it("stream records the omissions the finish event lists", async () => {
    const root = new RecordingSpan("root");

    await drain(
      traceProvider(
        streaming([
          {
            type: "finish",
            finishReason: "stop",
            omitted: [
              { kind: "outside-tool-call-id", toolCallIds: ["u1"] },
            ],
          },
        ]),
        root,
      ).stream(request),
    );

    expect(root.children[0]?.mergedAttributes[ATTR.llmOmitted]).toBe(
      '[{"kind":"outside-tool-call-id","toolCallIds":["u1"]}]',
    );
  });

  it("leaves mg.llm.omitted off the span when the response lists none", async () => {
    const root = new RecordingSpan("root");

    await traceProvider(
      generating({ parts: [], finishReason: "stop" }),
      root,
    ).generate(request);

    expect(
      ATTR.llmOmitted in (root.children[0]?.mergedAttributes ?? {}),
    ).toBe(false);
  });
});

describe("traceProvider / tool forcing", () => {
  const providerOf = (toolForcing: boolean): Provider => ({
    toolForcing,
    generate: async () => ({
      parts: [{ type: "text", text: "hello" }],
      finishReason: "stop",
    }),
    stream: async function* () {},
  });

  it("states true when the wrapped provider states true", () => {
    const root = new RecordingSpan("root");

    expect(traceProvider(providerOf(true), root).toolForcing).toBe(
      true,
    );
  });

  it("states false when the wrapped provider states false", () => {
    const root = new RecordingSpan("root");

    expect(traceProvider(providerOf(false), root).toolForcing).toBe(
      false,
    );
  });

  it("is assignable to ToolForcingProvider only when the wrapped provider can force", () => {
    const root = new RecordingSpan("root");

    const forcing: ToolForcingProvider = traceProvider(
      createOpenRouterProvider({ apiKey: "k" }),
      root,
    );
    // @ts-expect-error ollama cannot force a tool call
    const notForcing: ToolForcingProvider = traceProvider(
      createOllamaProvider(),
      root,
    );

    expect(forcing.toolForcing).toBe(true);
    expect(notForcing.toolForcing).toBe(false);
  });
});

describe("traceProvider / retried attempts", () => {
  const failure = (message: string) =>
    new ProviderRequestError(message, { retryable: true });
  const retrying = (inner: Provider): Provider =>
    createRetryingProvider({
      provider: inner,
      maxAttempts: 3,
      delaysMs: [10, 20],
      maxDelayMs: 1000,
      sleep: async () => {},
    });

  it("generate records one event per retried attempt and returns the answer", async () => {
    const root = new RecordingSpan("root");
    let calls = 0;
    const inner: Provider = {
      toolForcing: true,
      generate: async () => {
        calls++;
        if (calls === 1) throw failure("busy");
        if (calls === 2) throw failure("overloaded");
        return { parts: [], finishReason: "stop" };
      },
      stream: async function* () {},
    };

    const response = await traceProvider(
      retrying(inner),
      root,
    ).generate(request);

    expect(response.finishReason).toBe("stop");
    expect(root.children).toHaveLength(1);
    expect(root.children[0]?.events).toEqual([
      {
        name: EVENT.llmRetry,
        attributes: {
          [ATTR.llmRetryAttempt]: 1,
          [ATTR.llmRetryReason]: "busy",
          [ATTR.llmRetryWaitMs]: 10,
        },
      },
      {
        name: EVENT.llmRetry,
        attributes: {
          [ATTR.llmRetryAttempt]: 2,
          [ATTR.llmRetryReason]: "overloaded",
          [ATTR.llmRetryWaitMs]: 20,
        },
      },
    ]);
  });

  it("stream records the retried attempt and still calls the caller's listener", async () => {
    const root = new RecordingSpan("root");
    let calls = 0;
    const inner: Provider = {
      toolForcing: true,
      generate: async () => ({ parts: [], finishReason: "stop" }),
      stream: async function* () {
        calls++;
        if (calls === 1) throw failure("busy");
        yield { type: "finish", finishReason: "stop" };
      },
    };
    const heard: number[] = [];

    const events: StreamEvent[] = [];
    for await (const event of traceProvider(
      retrying(inner),
      root,
    ).stream({
      ...request,
      onRetry: (retry) => heard.push(retry.attempt),
    })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "finish", finishReason: "stop" }]);
    expect(heard).toEqual([1]);
    expect(root.children[0]?.events).toEqual([
      {
        name: EVENT.llmRetry,
        attributes: {
          [ATTR.llmRetryAttempt]: 1,
          [ATTR.llmRetryReason]: "busy",
          [ATTR.llmRetryWaitMs]: 10,
        },
      },
    ]);
  });

  it("records no retry event when the call is not retried", async () => {
    const root = new RecordingSpan("root");
    const inner: Provider = {
      toolForcing: true,
      generate: async () => ({ parts: [], finishReason: "stop" }),
      stream: async function* () {},
    };

    await traceProvider(retrying(inner), root).generate(request);

    expect(root.children[0]?.events).toEqual([]);
  });
});
