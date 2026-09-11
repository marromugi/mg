import type { GenerateResponse, Provider, StreamEvent, Tool, ToolCall, ToolSchema } from "@mg/core";
import { defineTool } from "@mg/core";
import { collect } from "@mg/harness";
import type { HarnessEvent, HarnessInput } from "@mg/harness";
import { describe, expect, test, vi } from "vitest";
import { createLoopHarness } from "./loop.js";

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

const stubProvider = (responses: readonly GenerateResponse[]): Provider => {
  let index = 0;
  const generate = vi.fn(async (): Promise<GenerateResponse> => {
    const response = responses[index];
    index++;
    if (!response) throw new Error("stubProvider: no scripted response left");
    return response;
  });
  const stream = vi.fn((): AsyncIterable<StreamEvent> => {
    throw new Error("stubProvider: stream is not scripted");
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

describe("createLoopHarness", () => {
  test("maxTurns 0 throws RangeError", () => {
    const provider = stubProvider([]);

    expect(() => createLoopHarness({ provider, model: "m", maxTurns: 0 })).toThrow(RangeError);
  });

  test("one turn without tool calls yields text-delta, turn, done(stop)", async () => {
    const input: HarnessInput = { messages: [{ role: "user", content: "hi" }] };
    const provider = stubProvider([
      { content: "hello", toolCalls: [], finishReason: "stop", usage: { inputTokens: 3, outputTokens: 5 } },
    ]);
    const harness = createLoopHarness({ provider, model: "m", maxTurns: 3 });

    const events: HarnessEvent[] = [];
    for await (const event of harness(input)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text-delta", delta: "hello" },
      { type: "turn", finishReason: "stop", usage: { inputTokens: 3, outputTokens: 5 } },
      {
        type: "done",
        result: {
          reason: "stop",
          messages: [
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" },
          ],
          usage: { inputTokens: 3, outputTokens: 5 },
        },
      },
    ]);
  });

  test("finishReason length without tool calls yields done(length)", async () => {
    const provider = stubProvider([{ content: "cut off", toolCalls: [], finishReason: "length" }]);
    const harness = createLoopHarness({ provider, model: "m", maxTurns: 2 });

    const result = await collect(harness({ messages: [] }));

    expect(result.reason).toBe("length");
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  test("maxTurns 1 with a tool-calling response yields tool-result then done(max-turns)", async () => {
    const toolCall: ToolCall = { id: "call-1", name: "a", arguments: {} };
    const tool: Tool = defineTool({ name: "a", input: stubSchema(), execute: async () => "a-result" });
    const provider = stubProvider([{ content: "", toolCalls: [toolCall], finishReason: "tool_calls" }]);
    const harness = createLoopHarness({ provider, model: "m", tools: [tool], maxTurns: 1 });

    const events: HarnessEvent[] = [];
    for await (const event of harness({ messages: [] })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(["tool-call", "turn", "tool-result", "done"]);
    expect(events).toContainEqual({
      type: "tool-result",
      message: { role: "tool", toolCallId: "call-1", content: "a-result" },
    });
    expect(events.at(-1)).toMatchObject({ type: "done", result: { reason: "max-turns" } });
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  test("an already-aborted signal rejects with AbortError before generate is called", async () => {
    const provider = stubProvider([]);
    const harness = createLoopHarness({ provider, model: "m", maxTurns: 1 });
    const controller = new AbortController();
    controller.abort();

    const error = await collect(harness({ messages: [], signal: controller.signal })).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toMatchObject({ name: "AbortError" });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  test("collect returns the same result as the done event", async () => {
    const response: GenerateResponse = {
      content: "hi",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1 },
    };

    const eventsProvider = stubProvider([response]);
    const eventsHarness = createLoopHarness({ provider: eventsProvider, model: "m", maxTurns: 1 });
    const events: HarnessEvent[] = [];
    for await (const event of eventsHarness({ messages: [] })) {
      events.push(event);
    }
    const doneEvent = events.find(
      (event): event is Extract<HarnessEvent, { type: "done" }> => event.type === "done",
    );

    const collectProvider = stubProvider([response]);
    const collectHarness = createLoopHarness({ provider: collectProvider, model: "m", maxTurns: 1 });
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
      { content: "", toolCalls, finishReason: "tool_calls" },
      { content: "done", toolCalls: [], finishReason: "stop" },
    ]);
    const harness = createLoopHarness({ provider, model: "m", tools: [toolA, toolB], maxTurns: 5 });
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
      message: { role: "tool", toolCallId: "call-1", content: "a-result" },
    });

    const secondToolResult = await iterator.next();
    expect(secondToolResult.value).toEqual({
      type: "tool-result",
      message: { role: "tool", toolCallId: "call-2", content: "b-result" },
    });

    const events: HarnessEvent[] = [];
    let next = await iterator.next();
    while (!next.done) {
      events.push(next.value);
      next = await iterator.next();
    }

    expect(events.map((event) => event.type)).toEqual(["text-delta", "turn", "done"]);
    expect(events.at(-1)).toMatchObject({ type: "done", result: { reason: "stop" } });
    expect(provider.generate).toHaveBeenCalledTimes(2);
  });
});
