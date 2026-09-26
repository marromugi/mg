import type {
  AssistantPart,
  GenerateRequest,
  GenerateResponse,
  Provider,
  StreamEvent,
  Tool,
  ToolCall,
  ToolSchema,
} from "@mg/core";
import { assistantMessage, defineTool } from "@mg/core";
import type { Gate, Verdict } from "@mg/gate";
import { collect } from "@mg/harness";
import type {
  HarnessEvent,
  HarnessInput,
  TraceAttributes,
  TraceSpan,
} from "@mg/harness";
import { traceProvider, traceRunToolCall } from "@mg/trace";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { StreamIncompleteError } from "./errors.js";
import { createLoopHarness } from "./loop.js";

vi.mock("@mg/trace", { spy: true });

class RecordingSpan implements TraceSpan {
  readonly name: string;
  readonly attributes: TraceAttributes;
  readonly children: RecordingSpan[] = [];
  readonly endCalls: unknown[] = [];

  constructor(name: string, attributes?: TraceAttributes) {
    this.name = name;
    this.attributes = attributes ?? {};
  }

  startSpan(name: string, attributes?: TraceAttributes): TraceSpan {
    const child = new RecordingSpan(name, attributes);
    this.children.push(child);
    return child;
  }

  startRoot(name: string, attributes?: TraceAttributes): TraceSpan {
    return this.startSpan(name, attributes);
  }

  setAttributes(): void {}

  addEvent(): void {}

  end(error?: unknown): void {
    this.endCalls.push(error);
  }
}

const stubSchema = (): ToolSchema => ({
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

const stubProvider = (
  responses: readonly GenerateResponse[],
): Provider => {
  let index = 0;
  const generate = vi.fn(async (): Promise<GenerateResponse> => {
    const response = responses[index];
    index++;
    if (!response)
      throw new Error("stubProvider: no scripted response left");
    return response;
  });
  const stream = vi.fn((): AsyncIterable<StreamEvent> => {
    throw new Error("stubProvider: stream is not scripted");
  });
  return { generate, stream };
};

const stubStreamProvider = (
  turns: readonly StreamEvent[][],
): Provider => {
  let index = 0;
  const generate = vi.fn(async (): Promise<GenerateResponse> => {
    throw new Error("stubStreamProvider: generate is not scripted");
  });
  const stream = vi.fn((): AsyncIterable<StreamEvent> => {
    const events = turns[index];
    index++;
    if (!events)
      throw new Error("stubStreamProvider: no scripted turn left");
    return (async function* () {
      for (const event of events) {
        yield event;
      }
    })();
  });
  return { generate, stream };
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const stubGate = (judge: Gate["judge"]): Gate => ({ judge });

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

const waitForHalt = (halt: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve) => {
    if (halt?.aborted) {
      resolve();
      return;
    }
    if (!halt) return;
    halt.addEventListener("abort", () => resolve(), { once: true });
  });

/**
 * A provider that streams (or, in batch mode, waits to return) the
 * scripted events for each turn, then waits for the request's halt
 * signal before ending the turn with reason "halted". A scripted turn
 * that already ends with a finish event ends without waiting.
 */
const haltingProvider = (
  turns: readonly (readonly StreamEvent[])[],
): Provider => {
  let index = 0;

  const generate = vi.fn(
    async (request: GenerateRequest): Promise<GenerateResponse> => {
      await waitForHalt(request.halt);
      return { parts: [], finishReason: "halted" };
    },
  );

  const stream = vi.fn(
    (request: GenerateRequest): AsyncIterable<StreamEvent> => {
      const events = turns[index] ?? [];
      index++;
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
  );

  return { generate, stream };
};

describe("createLoopHarness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("maxTurns 0 throws RangeError", () => {
    const provider = stubProvider([]);

    expect(() =>
      createLoopHarness({ provider, model: "m", maxTurns: 0 }),
    ).toThrow(RangeError);
  });

  test("maxTurns NaN throws RangeError", () => {
    const provider = stubProvider([]);

    expect(() =>
      createLoopHarness({ provider, model: "m", maxTurns: Number.NaN }),
    ).toThrow(RangeError);
  });

  test("one turn without tool calls yields text-delta, turn, done(stop)", async () => {
    const input: HarnessInput = {
      messages: [{ role: "user", content: "hi" }],
    };
    const provider = stubProvider([
      {
        parts: [{ type: "text", text: "hello" }],
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 5 },
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 3,
      stream: false,
    });

    const events: HarnessEvent[] = [];
    for await (const event of harness(input)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text-delta", delta: "hello" },
      {
        type: "turn",
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 5 },
      },
      {
        type: "done",
        result: {
          reason: "stop",
          messages: [
            { role: "user", content: "hi" },
            assistantMessage([{ type: "text", text: "hello" }]),
          ],
          usage: { inputTokens: 3, outputTokens: 5 },
        },
      },
    ]);
  });

  test("batch: a reasoning part before a text part yields reasoning-delta before text-delta, and history holds the reasoning part before the text part", async () => {
    const provider = stubProvider([
      {
        parts: [
          {
            type: "reasoning",
            text: "thinking",
            carry: { provider: "x", data: { step: 1 } },
          },
          { type: "text", text: "answer" },
        ],
        finishReason: "stop",
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
      stream: false,
    });

    const events: HarnessEvent[] = [];
    for await (const event of harness({ messages: [] })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "reasoning-delta",
      "text-delta",
      "turn",
      "done",
    ]);
    expect(events[0]).toEqual({
      type: "reasoning-delta",
      delta: "thinking",
    });
    const done = events.at(-1) as Extract<
      HarnessEvent,
      { type: "done" }
    >;
    expect(done.result.messages).toEqual([
      assistantMessage([
        {
          type: "reasoning",
          text: "thinking",
          carry: { provider: "x", data: { step: 1 } },
        },
        { type: "text", text: "answer" },
      ]),
    ]);
  });

  test("batch: a carry-only reasoning part (empty text) yields no reasoning-delta event but still lands in history", async () => {
    const provider = stubProvider([
      {
        parts: [
          {
            type: "reasoning",
            text: "",
            carry: { provider: "x", data: { step: 1 } },
          },
          { type: "text", text: "answer" },
        ],
        finishReason: "stop",
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
      stream: false,
    });

    const events: HarnessEvent[] = [];
    for await (const event of harness({ messages: [] })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "text-delta",
      "turn",
      "done",
    ]);
    const done = events.at(-1) as Extract<
      HarnessEvent,
      { type: "done" }
    >;
    expect(done.result.messages).toEqual([
      assistantMessage([
        {
          type: "reasoning",
          text: "",
          carry: { provider: "x", data: { step: 1 } },
        },
        { type: "text", text: "answer" },
      ]),
    ]);
  });

  test("finishReason length without tool calls yields done(length)", async () => {
    const provider = stubProvider([
      {
        parts: [{ type: "text", text: "cut off" }],
        finishReason: "length",
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 2,
      stream: false,
    });

    const result = await collect(harness({ messages: [] }));

    expect(result.reason).toBe("length");
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  test("maxTurns 1 with a tool-calling response yields tool-result then done(max-turns)", async () => {
    const toolCall: ToolCall = {
      id: "call-1",
      name: "a",
      arguments: {},
    };
    const tool: Tool = defineTool({
      name: "a",
      input: stubSchema(),
      execute: async () => "a-result",
    });
    const provider = stubProvider([
      {
        parts: [{ type: "tool-call", ...toolCall }],
        finishReason: "tool_calls",
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      tools: [tool],
      maxTurns: 1,
      stream: false,
    });

    const events: HarnessEvent[] = [];
    for await (const event of harness({ messages: [] })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "tool-call",
      "turn",
      "tool-result",
      "done",
    ]);
    expect(events).toContainEqual({
      type: "tool-result",
      message: {
        role: "tool",
        toolCallId: "call-1",
        content: "a-result",
      },
    });
    const done = events.at(-1);
    expect(done).toMatchObject({
      type: "done",
      result: { reason: "max-turns" },
    });
    expect(
      (done as Extract<HarnessEvent, { type: "done" }>).result.messages,
    ).toEqual([
      assistantMessage([{ type: "tool-call", ...toolCall }]),
      { role: "tool", toolCallId: "call-1", content: "a-result" },
    ]);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  test("an already-aborted signal rejects with AbortError before generate is called", async () => {
    const provider = stubProvider([]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
    });
    const controller = new AbortController();
    controller.abort();

    const error = await collect(
      harness({ messages: [], signal: controller.signal }),
    ).catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ name: "AbortError" });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  test("a signal aborted during generate rejects with AbortError before tools start", async () => {
    const controller = new AbortController();
    const toolCall: ToolCall = {
      id: "call-1",
      name: "a",
      arguments: {},
    };
    const execute = vi.fn(async () => "a-result");
    const tool: Tool = defineTool({
      name: "a",
      input: stubSchema(),
      execute,
    });

    const generate = vi.fn(async () => {
      controller.abort();
      return {
        parts: [{ type: "tool-call" as const, ...toolCall }],
        finishReason: "tool_calls" as const,
      };
    });
    const stream = vi.fn((): AsyncIterable<StreamEvent> => {
      throw new Error("stubProvider: stream is not scripted");
    });
    const provider: Provider = { generate, stream };

    const harness = createLoopHarness({
      provider,
      model: "m",
      tools: [tool],
      maxTurns: 2,
      stream: false,
    });

    const error = await collect(
      harness({ messages: [], signal: controller.signal }),
    ).catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ name: "AbortError" });
    expect(execute).not.toHaveBeenCalled();
  });

  test("collect returns the same result as the done event", async () => {
    const response: GenerateResponse = {
      parts: [{ type: "text", text: "hi" }],
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1 },
    };

    const eventsProvider = stubProvider([response]);
    const eventsHarness = createLoopHarness({
      provider: eventsProvider,
      model: "m",
      maxTurns: 1,
      stream: false,
    });
    const events: HarnessEvent[] = [];
    for await (const event of eventsHarness({ messages: [] })) {
      events.push(event);
    }
    const doneEvent = events.find(
      (event): event is Extract<HarnessEvent, { type: "done" }> =>
        event.type === "done",
    );

    const collectProvider = stubProvider([response]);
    const collectHarness = createLoopHarness({
      provider: collectProvider,
      model: "m",
      maxTurns: 1,
      stream: false,
    });
    const result = await collect(collectHarness({ messages: [] }));

    expect(result).toEqual(doneEvent?.result);
  });

  test("runs tool calls concurrently and appends results in call order", async () => {
    const started: string[] = [];
    const aDeferred = deferred<string>();
    const bDeferred = deferred<string>();

    const toolA: Tool = defineTool({
      name: "a",
      input: stubSchema(),
      execute: async () => {
        started.push("a");
        return aDeferred.promise;
      },
    });
    const toolB: Tool = defineTool({
      name: "b",
      input: stubSchema(),
      execute: async () => {
        started.push("b");
        return bDeferred.promise;
      },
    });

    const toolCalls: ToolCall[] = [
      { id: "call-1", name: "a", arguments: {} },
      { id: "call-2", name: "b", arguments: {} },
    ];
    const provider = stubProvider([
      {
        parts: toolCalls.map((toolCall): AssistantPart => ({
          type: "tool-call",
          ...toolCall,
        })),
        finishReason: "tool_calls",
        usage: { inputTokens: 2, outputTokens: 3 },
      },
      {
        parts: [{ type: "text", text: "done" }],
        finishReason: "stop",
        usage: { inputTokens: 4, outputTokens: 6 },
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      tools: [toolA, toolB],
      maxTurns: 5,
      stream: false,
    });
    const iterator = harness({ messages: [] })[Symbol.asyncIterator]();

    let result = await iterator.next();
    while (result.value && result.value.type !== "turn") {
      result = await iterator.next();
    }

    const pendingNext = iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(["a", "b"]);

    bDeferred.resolve("b-result");
    await new Promise((resolve) => setTimeout(resolve, 0));
    aDeferred.resolve("a-result");

    const firstToolResult = await pendingNext;
    expect(firstToolResult.value).toEqual({
      type: "tool-result",
      message: {
        role: "tool",
        toolCallId: "call-1",
        content: "a-result",
      },
    });

    const secondToolResult = await iterator.next();
    expect(secondToolResult.value).toEqual({
      type: "tool-result",
      message: {
        role: "tool",
        toolCallId: "call-2",
        content: "b-result",
      },
    });

    const events: HarnessEvent[] = [];
    let next = await iterator.next();
    while (!next.done) {
      events.push(next.value);
      next = await iterator.next();
    }

    expect(events.map((event) => event.type)).toEqual([
      "text-delta",
      "turn",
      "done",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "done",
      result: {
        reason: "stop",
        usage: { inputTokens: 6, outputTokens: 9 },
      },
    });
    expect(provider.generate).toHaveBeenCalledTimes(2);
  });

  test("stream: three text deltas then finish yields three text-delta events, then turn, then done(stop)", async () => {
    const provider = stubStreamProvider([
      [
        { type: "text-delta", delta: "Hel" },
        { type: "text-delta", delta: "lo, " },
        { type: "text-delta", delta: "world" },
        {
          type: "finish",
          finishReason: "stop",
          usage: { inputTokens: 3, outputTokens: 5 },
        },
      ],
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 3,
    });

    const events: HarnessEvent[] = [];
    for await (const event of harness({
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text-delta", delta: "Hel" },
      { type: "text-delta", delta: "lo, " },
      { type: "text-delta", delta: "world" },
      {
        type: "turn",
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 5 },
      },
      {
        type: "done",
        result: {
          reason: "stop",
          messages: [
            { role: "user", content: "hi" },
            assistantMessage([{ type: "text", text: "Hello, world" }]),
          ],
          usage: { inputTokens: 3, outputTokens: 5 },
        },
      },
    ]);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  test("stream: reasoning deltas then a text delta yields reasoning-delta before text-delta, and history holds the reasoning part before the text part", async () => {
    const provider = stubStreamProvider([
      [
        { type: "reasoning-delta", delta: "think" },
        {
          type: "reasoning-delta",
          delta: "ing",
          carry: { provider: "x", data: { step: 1 } },
        },
        { type: "text-delta", delta: "answer" },
        { type: "finish", finishReason: "stop" },
      ],
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
    });

    const events: HarnessEvent[] = [];
    for await (const event of harness({ messages: [] })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "reasoning-delta",
      "reasoning-delta",
      "text-delta",
      "turn",
      "done",
    ]);
    expect(
      events.filter((event) => event.type === "reasoning-delta"),
    ).toEqual([
      { type: "reasoning-delta", delta: "think" },
      { type: "reasoning-delta", delta: "ing" },
    ]);
    const done = events.at(-1) as Extract<
      HarnessEvent,
      { type: "done" }
    >;
    expect(done.result.messages).toEqual([
      assistantMessage([
        {
          type: "reasoning",
          text: "thinking",
          carry: { provider: "x", data: { step: 1 } },
        },
        { type: "text", text: "answer" },
      ]),
    ]);
  });

  test("stream: an empty-delta reasoning-delta event (carry only) yields no event but the carry still lands in history", async () => {
    const provider = stubStreamProvider([
      [
        { type: "reasoning-delta", delta: "think" },
        { type: "text-delta", delta: "answer" },
        {
          type: "reasoning-delta",
          delta: "",
          carry: { provider: "x", data: { step: 2 } },
        },
        { type: "finish", finishReason: "stop" },
      ],
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
    });

    const events: HarnessEvent[] = [];
    for await (const event of harness({ messages: [] })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "reasoning-delta",
      "text-delta",
      "turn",
      "done",
    ]);
    const done = events.at(-1) as Extract<
      HarnessEvent,
      { type: "done" }
    >;
    expect(done.result.messages).toEqual([
      assistantMessage([
        { type: "reasoning", text: "think" },
        { type: "text", text: "answer" },
        {
          type: "reasoning",
          text: "",
          carry: { provider: "x", data: { step: 2 } },
        },
      ]),
    ]);
  });

  test("stream: deltas then two tool calls then finish matches the batch mode events and messages", async () => {
    const toolCallA: ToolCall = {
      id: "call-1",
      name: "a",
      arguments: {},
    };
    const toolCallB: ToolCall = {
      id: "call-2",
      name: "b",
      arguments: {},
    };
    const toolCalls: ToolCall[] = [toolCallA, toolCallB];
    const toolA: Tool = defineTool({
      name: "a",
      input: stubSchema(),
      execute: async () => "a-result",
    });
    const toolB: Tool = defineTool({
      name: "b",
      input: stubSchema(),
      execute: async () => "b-result",
    });

    const streamProvider = stubStreamProvider([
      [
        { type: "text-delta", delta: "thinking" },
        { type: "text-delta", delta: "..." },
        { type: "tool-call", toolCall: toolCallA },
        { type: "tool-call", toolCall: toolCallB },
        { type: "finish", finishReason: "tool_calls" },
      ],
    ]);
    const streamHarness = createLoopHarness({
      provider: streamProvider,
      model: "m",
      tools: [toolA, toolB],
      maxTurns: 1,
    });
    const streamEvents: HarnessEvent[] = [];
    for await (const event of streamHarness({ messages: [] })) {
      streamEvents.push(event);
    }

    const batchProvider = stubProvider([
      {
        parts: [
          { type: "text", text: "thinking..." },
          ...toolCalls.map((toolCall): AssistantPart => ({
            type: "tool-call",
            ...toolCall,
          })),
        ],
        finishReason: "tool_calls",
      },
    ]);
    const batchHarness = createLoopHarness({
      provider: batchProvider,
      model: "m",
      tools: [toolA, toolB],
      maxTurns: 1,
      stream: false,
    });
    const batchEvents: HarnessEvent[] = [];
    for await (const event of batchHarness({ messages: [] })) {
      batchEvents.push(event);
    }

    const typesWithoutTextDelta = (events: HarnessEvent[]) =>
      events
        .filter((event) => event.type !== "text-delta")
        .map((event) => event.type);

    expect(typesWithoutTextDelta(streamEvents)).toEqual(
      typesWithoutTextDelta(batchEvents),
    );
    expect(
      streamEvents.filter((event) => event.type === "text-delta"),
    ).toHaveLength(2);
    expect(
      batchEvents.filter((event) => event.type === "text-delta"),
    ).toHaveLength(1);

    const streamDone = streamEvents.at(-1) as Extract<
      HarnessEvent,
      { type: "done" }
    >;
    const batchDone = batchEvents.at(-1) as Extract<
      HarnessEvent,
      { type: "done" }
    >;
    expect(streamDone.result.messages).toEqual(
      batchDone.result.messages,
    );
  });

  test("stream: false uses generate and never calls stream", async () => {
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
      stream: false,
    });

    await collect(harness({ messages: [] }));

    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(provider.stream).not.toHaveBeenCalled();
  });

  test("default (stream option omitted) uses stream and never calls generate", async () => {
    const provider = stubStreamProvider([
      [{ type: "finish", finishReason: "stop" }],
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
    });

    await collect(harness({ messages: [] }));

    expect(provider.stream).toHaveBeenCalledTimes(1);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  test("a stream iterable that throws mid-way rejects with that error and never calls generate", async () => {
    const boom = new Error("boom");
    const generate = vi.fn(async (): Promise<GenerateResponse> => {
      throw new Error("stubProvider: generate is not scripted");
    });
    const stream = vi.fn((): AsyncIterable<StreamEvent> => {
      return (async function* () {
        yield {
          type: "text-delta",
          delta: "partial",
        } satisfies StreamEvent;
        throw boom;
      })();
    });
    const provider: Provider = { generate, stream };
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
    });

    const error = await collect(harness({ messages: [] })).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBe(boom);
    expect(generate).not.toHaveBeenCalled();
  });

  test("a stream that ends without a finish event rejects with StreamIncompleteError", async () => {
    const generate = vi.fn(async (): Promise<GenerateResponse> => {
      throw new Error("stubProvider: generate is not scripted");
    });
    const stream = vi.fn((): AsyncIterable<StreamEvent> => {
      return (async function* () {
        yield {
          type: "text-delta",
          delta: "partial",
        } satisfies StreamEvent;
      })();
    });
    const provider: Provider = { generate, stream };
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
    });

    const error = await collect(harness({ messages: [] })).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(StreamIncompleteError);
    expect(generate).not.toHaveBeenCalled();
  });

  test("a failing tool call yields an error message and the loop continues", async () => {
    const toolA: Tool = defineTool({
      name: "a",
      input: stubSchema(),
      execute: async () => {
        throw new Error("boom");
      },
    });
    const toolB: Tool = defineTool({
      name: "b",
      input: stubSchema(),
      execute: async () => "b-result",
    });

    const toolCalls: ToolCall[] = [
      { id: "call-1", name: "a", arguments: {} },
      { id: "call-2", name: "b", arguments: {} },
    ];
    const provider = stubProvider([
      {
        parts: toolCalls.map((toolCall): AssistantPart => ({
          type: "tool-call",
          ...toolCall,
        })),
        finishReason: "tool_calls",
      },
      {
        parts: [{ type: "text", text: "done" }],
        finishReason: "stop",
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      tools: [toolA, toolB],
      maxTurns: 5,
      stream: false,
    });

    const events: HarnessEvent[] = [];
    for await (const event of harness({ messages: [] })) {
      events.push(event);
    }

    const toolResults = events.filter(
      (
        event,
      ): event is Extract<HarnessEvent, { type: "tool-result" }> =>
        event.type === "tool-result",
    );
    expect(toolResults).toEqual([
      {
        type: "tool-result",
        message: {
          role: "tool",
          toolCallId: "call-1",
          content: "[Error] boom",
        },
      },
      {
        type: "tool-result",
        message: {
          role: "tool",
          toolCallId: "call-2",
          content: "b-result",
        },
      },
    ]);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toMatchObject({
      type: "done",
      result: { reason: "stop" },
    });
  });

  test("an AbortError thrown by execute rejects the harness with the same error", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const tool: Tool = defineTool({
      name: "a",
      input: stubSchema(),
      execute: async () => {
        throw abortError;
      },
    });
    const toolCall: ToolCall = {
      id: "call-1",
      name: "a",
      arguments: {},
    };
    const provider = stubProvider([
      {
        parts: [{ type: "tool-call", ...toolCall }],
        finishReason: "tool_calls",
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      tools: [tool],
      maxTurns: 2,
      stream: false,
    });

    const error = await collect(harness({ messages: [] })).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBe(abortError);
  });

  test("with a trace, wraps the loop in one mg.harness span with an mg.llm span per turn and an mg.tool span per tool call", async () => {
    const toolCall: ToolCall = {
      id: "call-1",
      name: "a",
      arguments: {},
    };
    const tool: Tool = defineTool({
      name: "a",
      input: stubSchema(),
      execute: async () => "a-result",
    });
    const provider = stubProvider([
      {
        parts: [{ type: "tool-call", ...toolCall }],
        finishReason: "tool_calls",
      },
      {
        parts: [{ type: "text", text: "done" }],
        finishReason: "stop",
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      tools: [tool],
      maxTurns: 2,
      stream: false,
    });

    const root = new RecordingSpan("root");
    const result = await collect(
      harness({ messages: [], trace: root }),
    );

    expect(result.reason).toBe("stop");
    expect(root.children).toHaveLength(1);

    const harnessSpan = root.children[0];
    expect(harnessSpan.name).toBe("mg.harness");
    expect(harnessSpan.attributes["mg.harness.name"]).toBe("loop");
    expect(harnessSpan.children.map((child) => child.name)).toEqual([
      "mg.llm",
      "mg.tool",
      "mg.llm",
    ]);
    expect(harnessSpan.endCalls).toEqual([undefined]);
  });

  test("a provider that throws ends the mg.harness span with that error and the error propagates unchanged", async () => {
    const boom = new Error("boom");
    const generate = vi.fn(async (): Promise<GenerateResponse> => {
      throw boom;
    });
    const stream = vi.fn((): AsyncIterable<StreamEvent> => {
      throw new Error("stubProvider: stream is not scripted");
    });
    const provider: Provider = { generate, stream };
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
      stream: false,
    });

    const root = new RecordingSpan("root");
    const error = await collect(
      harness({ messages: [], trace: root }),
    ).catch((thrown: unknown) => thrown);

    expect(error).toBe(boom);
    const harnessSpan = root.children[0];
    expect(harnessSpan.endCalls).toEqual([boom]);
  });

  test("input.trace omitted leaves the loop's result unchanged from the traced case", async () => {
    const response: GenerateResponse = {
      parts: [{ type: "text", text: "hi" }],
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1 },
    };

    const untracedHarness = createLoopHarness({
      provider: stubProvider([response]),
      model: "m",
      maxTurns: 1,
      stream: false,
    });
    const untracedResult = await collect(
      untracedHarness({ messages: [] }),
    );

    const root = new RecordingSpan("root");
    const tracedHarness = createLoopHarness({
      provider: stubProvider([response]),
      model: "m",
      maxTurns: 1,
      stream: false,
    });
    const tracedResult = await collect(
      tracedHarness({ messages: [], trace: root }),
    );

    expect(tracedResult).toEqual(untracedResult);
  });

  test("input.trace omitted does not call traceProvider or traceRunToolCall", async () => {
    const response: GenerateResponse = {
      parts: [{ type: "text", text: "hi" }],
      finishReason: "stop",
    };
    const harness = createLoopHarness({
      provider: stubProvider([response]),
      model: "m",
      maxTurns: 1,
      stream: false,
    });

    await collect(harness({ messages: [] }));

    expect(traceProvider).not.toHaveBeenCalled();
    expect(traceRunToolCall).not.toHaveBeenCalled();
  });

  test("input.trace passed calls traceProvider and traceRunToolCall once each", async () => {
    const response: GenerateResponse = {
      parts: [{ type: "text", text: "hi" }],
      finishReason: "stop",
    };
    const harness = createLoopHarness({
      provider: stubProvider([response]),
      model: "m",
      maxTurns: 1,
      stream: false,
    });
    const root = new RecordingSpan("root");

    await collect(harness({ messages: [], trace: root }));

    expect(traceProvider).toHaveBeenCalledTimes(1);
    expect(traceRunToolCall).toHaveBeenCalledTimes(1);
  });

  test("a gate that denies leaves the tool unrun, appends the denial as the tool result, and the loop proceeds to the next turn", async () => {
    const execute = vi.fn(async () => "a-result");
    const tool: Tool = defineTool({
      name: "a",
      input: stubSchema(),
      execute,
    });
    const toolCall: ToolCall = {
      id: "call-1",
      name: "a",
      arguments: {},
    };
    const provider = stubProvider([
      {
        parts: [{ type: "tool-call", ...toolCall }],
        finishReason: "tool_calls",
      },
      {
        parts: [{ type: "text", text: "done" }],
        finishReason: "stop",
      },
    ]);
    const gate = stubGate(async (): Promise<Verdict> => ({
      allowed: false,
      reason: "writes to disk",
    }));
    const harness = createLoopHarness({
      provider,
      model: "m",
      tools: [tool],
      maxTurns: 5,
      stream: false,
      gate,
    });

    const events: HarnessEvent[] = [];
    for await (const event of harness({ messages: [] })) {
      events.push(event);
    }

    expect(execute).not.toHaveBeenCalled();
    const toolResult = events.find(
      (
        event,
      ): event is Extract<HarnessEvent, { type: "tool-result" }> =>
        event.type === "tool-result",
    );
    expect(toolResult?.message.toolCallId).toBe("call-1");
    expect(toolResult?.message.content).toContain("[denied]");
    expect(toolResult?.message.content).toContain("writes to disk");

    const done = events.at(-1) as Extract<
      HarnessEvent,
      { type: "done" }
    >;
    expect(done.result.reason).toBe("stop");
    expect(done.result.messages).toContainEqual(toolResult?.message);
    expect(provider.generate).toHaveBeenCalledTimes(2);
  });

  test("a gate that allows runs the tool", async () => {
    const execute = vi.fn(async () => "a-result");
    const tool: Tool = defineTool({
      name: "a",
      input: stubSchema(),
      execute,
    });
    const toolCall: ToolCall = {
      id: "call-1",
      name: "a",
      arguments: {},
    };
    const provider = stubProvider([
      {
        parts: [{ type: "tool-call", ...toolCall }],
        finishReason: "tool_calls",
      },
    ]);
    const gate = stubGate(async (): Promise<Verdict> => ({
      allowed: true,
      reason: "ok",
    }));
    const harness = createLoopHarness({
      provider,
      model: "m",
      tools: [tool],
      maxTurns: 1,
      stream: false,
      gate,
    });

    const result = await collect(harness({ messages: [] }));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.messages).toContainEqual({
      role: "tool",
      toolCallId: "call-1",
      content: "a-result",
    });
  });

  test("with a trace and a gate, mg.gate is a sibling of mg.tool under mg.harness, and a denied call produces no mg.tool span", async () => {
    const execute = vi.fn(async () => "a-result");
    const tool: Tool = defineTool({
      name: "a",
      input: stubSchema(),
      execute,
    });
    const toolCall: ToolCall = {
      id: "call-1",
      name: "a",
      arguments: {},
    };
    const provider = stubProvider([
      {
        parts: [{ type: "tool-call", ...toolCall }],
        finishReason: "tool_calls",
      },
      {
        parts: [{ type: "text", text: "done" }],
        finishReason: "stop",
      },
    ]);
    const gate = stubGate(
      async (request, context): Promise<Verdict> => {
        context?.trace?.startSpan("mg.gate", {});
        return { allowed: false, reason: "writes to disk" };
      },
    );
    const harness = createLoopHarness({
      provider,
      model: "m",
      tools: [tool],
      maxTurns: 2,
      stream: false,
      gate,
    });

    const root = new RecordingSpan("root");
    await collect(harness({ messages: [], trace: root }));

    expect(execute).not.toHaveBeenCalled();
    const harnessSpan = root.children[0];
    expect(harnessSpan.name).toBe("mg.harness");
    expect(harnessSpan.children.map((child) => child.name)).toEqual([
      "mg.llm",
      "mg.gate",
      "mg.llm",
    ]);
  });
});

describe("createLoopHarness wrapping up", () => {
  test("stops generation on a halted turn, keeping the partial text as the turn's assistant message", async () => {
    const controller = new AbortController();
    const provider = haltingProvider([
      [{ type: "text-delta", delta: "Hel" }],
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
    });

    const events: HarnessEvent[] = [];
    for await (const event of harness({
      messages: [{ role: "user", content: "hi" }],
      wrapUp: controller.signal,
    })) {
      events.push(event);
      if (event.type === "text-delta") controller.abort();
    }

    expect(events).toEqual([
      { type: "text-delta", delta: "Hel" },
      { type: "turn", finishReason: "halted" },
      {
        type: "done",
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
      },
    ]);
  });

  test("does not run a tool call parsed from a halted turn's partial message", async () => {
    const controller = new AbortController();
    const provider = haltingProvider([
      [
        { type: "text-delta", delta: "a" },
        {
          type: "tool-call",
          toolCall: { id: "c1", name: "ls", arguments: {} },
        },
      ],
    ]);
    const execute = vi.fn(async () => "ls-result");
    const ls: Tool = defineTool({
      name: "ls",
      input: stubSchema(),
      execute,
    });
    const harness = createLoopHarness({
      provider,
      tools: [ls],
      model: "m",
      maxTurns: 1,
    });

    const events: HarnessEvent[] = [];
    for await (const event of harness({
      messages: [{ role: "user", content: "hi" }],
      wrapUp: controller.signal,
    })) {
      events.push(event);
      if (event.type === "tool-call") controller.abort();
    }

    expect(execute).not.toHaveBeenCalled();
    const done = events.at(-1) as Extract<
      HarnessEvent,
      { type: "done" }
    >;
    expect(done.result.messages.at(-2)).toEqual(
      assistantMessage([
        { type: "text", text: "a" },
        { type: "tool-call", id: "c1", name: "ls", arguments: {} },
      ]),
    );
    expect(done.result.messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "c1",
      content:
        "[not-run] The call was not run because the run was wrapped up.",
    });
    expect(
      events.some(
        (event) =>
          event.type === "tool-result" &&
          event.message.toolCallId === "c1",
      ),
    ).toBe(true);
  });

  test("ends the batch turn wrapped up when the provider halts before returning", async () => {
    const controller = new AbortController();
    const provider = haltingProvider([[]]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
      stream: false,
    });

    const resultPromise = collect(
      harness({
        messages: [{ role: "user", content: "hi" }],
        wrapUp: controller.signal,
      }),
    );
    await flushMicrotasks();
    expect(provider.generate).toHaveBeenCalledTimes(1);
    controller.abort();
    const result = await resultPromise;

    expect(result).toEqual({
      reason: "wrapped-up",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", parts: [] },
      ],
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  test("does not run a tool call when wrap-up arrives before the tool starts", async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => "ls-result");
    const ls: Tool = defineTool({
      name: "ls",
      input: stubSchema(),
      execute,
    });
    const generate = vi.fn(async (): Promise<GenerateResponse> => {
      controller.abort();
      return {
        parts: [
          { type: "tool-call", id: "c1", name: "ls", arguments: {} },
        ],
        finishReason: "tool_calls",
      };
    });
    const stream = vi.fn((): AsyncIterable<StreamEvent> => {
      throw new Error("not scripted");
    });
    const provider: Provider = { generate, stream };
    const harness = createLoopHarness({
      provider,
      tools: [ls],
      model: "m",
      maxTurns: 2,
      stream: false,
    });

    const result = await collect(
      harness({
        messages: [{ role: "user", content: "hi" }],
        wrapUp: controller.signal,
      }),
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result.messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "c1",
      content:
        "[not-run] The call was not run because the run was wrapped up.",
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  test("stops a running tool with its context's abort signal when wrap-up arrives, keeping an already-finished call's real result", async () => {
    const controller = new AbortController();
    const slowContext: { signal?: AbortSignal } = {};
    const fastDeferred = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    })();
    const slow: Tool = defineTool({
      name: "slow",
      input: stubSchema(),
      execute: (_input, context) => {
        slowContext.signal = context.signal;
        return new Promise<string>(() => {});
      },
    });
    const fast: Tool = defineTool({
      name: "fast",
      input: stubSchema(),
      execute: async () => {
        fastDeferred.resolve();
        return "ok";
      },
    });
    const provider = stubProvider([
      {
        parts: [
          { type: "tool-call", id: "c1", name: "slow", arguments: {} },
          { type: "tool-call", id: "c2", name: "fast", arguments: {} },
        ],
        finishReason: "tool_calls",
      },
    ]);
    const harness = createLoopHarness({
      provider,
      tools: [slow, fast],
      model: "m",
      maxTurns: 2,
      stream: false,
    });

    const resultPromise = collect(
      harness({
        messages: [{ role: "user", content: "hi" }],
        wrapUp: controller.signal,
      }),
    );
    await fastDeferred.promise;
    await flushMicrotasks();
    controller.abort();
    const result = await resultPromise;

    expect(result.reason).toBe("wrapped-up");
    expect(result.messages.slice(-2)).toEqual([
      {
        role: "tool",
        toolCallId: "c1",
        content:
          "[stopped] The call was stopped before it finished because the run was wrapped up. Whether it took effect is unknown.",
      },
      { role: "tool", toolCallId: "c2", content: "ok" },
    ]);
    expect(slowContext.signal?.aborted).toBe(true);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  test("does not start another turn once wrap-up arrives after a tool call already finished", async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => "ok");
    const ls: Tool = defineTool({
      name: "ls",
      input: stubSchema(),
      execute,
    });
    const provider = stubProvider([
      {
        parts: [
          { type: "tool-call", id: "c1", name: "ls", arguments: {} },
        ],
        finishReason: "tool_calls",
      },
      { parts: [{ type: "text", text: "done" }], finishReason: "stop" },
    ]);
    const harness = createLoopHarness({
      provider,
      tools: [ls],
      model: "m",
      maxTurns: 2,
      stream: false,
    });

    const events: HarnessEvent[] = [];
    for await (const event of harness({
      messages: [{ role: "user", content: "hi" }],
      wrapUp: controller.signal,
    })) {
      events.push(event);
      if (event.type === "tool-result") controller.abort();
    }

    const done = events.at(-1) as Extract<
      HarnessEvent,
      { type: "done" }
    >;
    expect(done.result.messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "c1",
      content: "ok",
    });
    expect(done.result.reason).toBe("wrapped-up");
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  test("does not call the provider when wrap-up has already arrived", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = stubProvider([]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
      stream: false,
    });

    const events: HarnessEvent[] = [];
    for await (const event of harness({
      messages: [{ role: "user", content: "hi" }],
      wrapUp: controller.signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "done",
        result: {
          reason: "wrapped-up",
          messages: [{ role: "user", content: "hi" }],
          usage: { inputTokens: 0, outputTokens: 0 },
        },
      },
    ]);
    expect(provider.generate).not.toHaveBeenCalled();
    expect(provider.stream).not.toHaveBeenCalled();
  });

  test("keeps the ordinary stop reason when the last turn ends without a tool call, even after wrap-up arrives", async () => {
    const controller = new AbortController();
    const generate = vi.fn(async (): Promise<GenerateResponse> => {
      controller.abort();
      return {
        parts: [{ type: "text", text: "done" }],
        finishReason: "stop",
      };
    });
    const stream = vi.fn((): AsyncIterable<StreamEvent> => {
      throw new Error("not scripted");
    });
    const provider: Provider = { generate, stream };
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
      stream: false,
    });

    const result = await collect(
      harness({
        messages: [{ role: "user", content: "hi" }],
        wrapUp: controller.signal,
      }),
    );

    expect(result.reason).toBe("stop");
  });

  test("rejects with the abort error when both the abort signal and wrap-up have already arrived", async () => {
    const signalController = new AbortController();
    signalController.abort();
    const wrapUpController = new AbortController();
    wrapUpController.abort();
    const provider = stubProvider([]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
    });

    const error = await collect(
      harness({
        messages: [{ role: "user", content: "hi" }],
        signal: signalController.signal,
        wrapUp: wrapUpController.signal,
      }),
    ).catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ name: "AbortError" });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(provider.stream).not.toHaveBeenCalled();
  });

  test("ends the harness span without an error when wrapping up on a halted turn", async () => {
    const controller = new AbortController();
    const provider = haltingProvider([
      [{ type: "text-delta", delta: "Hel" }],
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
    });
    const root = new RecordingSpan("root");

    for await (const event of harness({
      messages: [{ role: "user", content: "hi" }],
      wrapUp: controller.signal,
      trace: root,
    })) {
      if (event.type === "text-delta") controller.abort();
    }

    expect(root.children).toHaveLength(1);
    expect(root.children[0]?.name).toBe("mg.harness");
    expect(root.children[0]?.endCalls).toEqual([undefined]);
  });
});

describe("createLoopHarness stop reason attribute", () => {
  class AttributeRecordingSpan implements TraceSpan {
    readonly name: string;
    readonly children: AttributeRecordingSpan[] = [];
    readonly setAttributesCalls: TraceAttributes[] = [];
    readonly endCalls: unknown[] = [];

    constructor(name: string) {
      this.name = name;
    }

    startSpan(name: string): TraceSpan {
      const child = new AttributeRecordingSpan(name);
      this.children.push(child);
      return child;
    }

    startRoot(name: string): TraceSpan {
      return this.startSpan(name);
    }

    setAttributes(attributes: TraceAttributes): void {
      this.setAttributesCalls.push(attributes);
    }

    addEvent(): void {}

    end(error?: unknown): void {
      this.endCalls.push(error);
    }
  }

  const stopReasonOf = (
    span: AttributeRecordingSpan,
  ): TraceAttributes[string] | undefined =>
    Object.assign({}, ...span.setAttributesCalls)[
      "mg.harness.stop_reason"
    ];

  test("writes the stop reason stop on the mg.harness span when the turn ends without tool calls", async () => {
    const provider = stubProvider([
      {
        parts: [{ type: "text", text: "hi" }],
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 1 },
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
      stream: false,
    });
    const root = new AttributeRecordingSpan("root");

    await collect(
      harness({
        messages: [{ role: "user", content: "q" }],
        trace: root,
      }),
    );

    expect(stopReasonOf(root.children[0])).toBe("stop");
  });

  test("writes the stop reason max-turns when the loop reaches its turn limit", async () => {
    const toolCall: ToolCall = {
      id: "call-1",
      name: "a",
      arguments: {},
    };
    const tool: Tool = defineTool({
      name: "a",
      input: stubSchema(),
      execute: async () => "a-result",
    });
    const provider = stubProvider([
      {
        parts: [{ type: "tool-call", ...toolCall }],
        finishReason: "tool_calls",
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      tools: [tool],
      maxTurns: 1,
      stream: false,
    });
    const root = new AttributeRecordingSpan("root");

    const result = await collect(
      harness({
        messages: [{ role: "user", content: "q" }],
        trace: root,
      }),
    );

    expect(result.reason).toBe("max-turns");
    expect(stopReasonOf(root.children[0])).toBe("max-turns");
  });

  test("writes the stop reason length when the provider finishes with reason length", async () => {
    const provider = stubProvider([
      {
        parts: [{ type: "text", text: "hi" }],
        finishReason: "length",
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
      stream: false,
    });
    const root = new AttributeRecordingSpan("root");

    await collect(
      harness({
        messages: [{ role: "user", content: "q" }],
        trace: root,
      }),
    );

    expect(stopReasonOf(root.children[0])).toBe("length");
  });

  test("writes the stop reason wrapped-up when the wrap-up signal has already arrived", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = stubProvider([]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
      stream: false,
    });
    const root = new AttributeRecordingSpan("root");

    await collect(
      harness({
        messages: [{ role: "user", content: "q" }],
        wrapUp: controller.signal,
        trace: root,
      }),
    );

    expect(stopReasonOf(root.children[0])).toBe("wrapped-up");
  });

  test("does not write the stop reason when the provider throws, and the span still ends with that error", async () => {
    const boom = new Error("boom");
    const provider: Provider = {
      generate: vi.fn(async (): Promise<GenerateResponse> => {
        throw boom;
      }),
      stream: vi.fn((): AsyncIterable<StreamEvent> => {
        throw new Error("stubProvider: stream is not scripted");
      }),
    };
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
      stream: false,
    });
    const root = new AttributeRecordingSpan("root");

    const error = await collect(
      harness({
        messages: [{ role: "user", content: "q" }],
        trace: root,
      }),
    ).catch((thrown: unknown) => thrown);

    expect(error).toBe(boom);
    const harnessSpan = root.children[0];
    expect(harnessSpan.endCalls).toEqual([boom]);
    expect(stopReasonOf(harnessSpan)).toBeUndefined();
  });

  test("keeps the run from failing when the mg.harness span's setAttributes always throws", async () => {
    class PassthroughSpan implements TraceSpan {
      startSpan(): TraceSpan {
        return this;
      }

      startRoot(): TraceSpan {
        return this;
      }

      setAttributes(): void {}

      addEvent(): void {}

      end(): void {}
    }

    const passthrough = new PassthroughSpan();

    class ThrowingAttributesSpan implements TraceSpan {
      readonly setAttributesCalls: TraceAttributes[] = [];

      startSpan(): TraceSpan {
        return passthrough;
      }

      startRoot(): TraceSpan {
        return passthrough;
      }

      setAttributes(attributes: TraceAttributes): void {
        this.setAttributesCalls.push(attributes);
        throw new Error("span");
      }

      addEvent(): void {}

      end(): void {}
    }

    class ParentOfThrowingSpan implements TraceSpan {
      readonly child = new ThrowingAttributesSpan();

      startSpan(): TraceSpan {
        return this.child;
      }

      startRoot(): TraceSpan {
        return this.child;
      }

      setAttributes(): void {}

      addEvent(): void {}

      end(): void {}
    }

    const root = new ParentOfThrowingSpan();
    const provider = stubProvider([
      {
        parts: [{ type: "text", text: "hi" }],
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 1 },
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
      stream: false,
    });

    const result = await collect(
      harness({
        messages: [{ role: "user", content: "q" }],
        trace: root,
      }),
    );

    expect(result.reason).toBe("stop");
    expect(root.child.setAttributesCalls.length).toBeGreaterThan(0);
  });

  test("leaves the result unchanged when no trace is passed", async () => {
    const provider = stubProvider([
      {
        parts: [{ type: "text", text: "hi" }],
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 1 },
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      maxTurns: 1,
      stream: false,
    });

    const result = await collect(
      harness({ messages: [{ role: "user", content: "q" }] }),
    );

    expect(result).toEqual({
      reason: "stop",
      messages: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          parts: [{ type: "text", text: "hi" }],
        },
      ],
      usage: { inputTokens: 3, outputTokens: 1 },
    });
  });
});
