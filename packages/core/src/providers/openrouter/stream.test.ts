import { describe, expect, test } from "vitest";
import { ProviderHttpError, ToolArgumentsError } from "../errors.js";
import type { StreamEvent } from "../types.js";
import { toStreamEvents } from "./stream.js";

const payloadsOf = async function* (chunks: unknown[]): AsyncGenerator<string> {
  for (const chunk of chunks) {
    yield typeof chunk === "string" ? chunk : JSON.stringify(chunk);
  }
};

const collect = async (chunks: unknown[]): Promise<StreamEvent[]> => {
  const events: StreamEvent[] = [];
  for await (const event of toStreamEvents(payloadsOf(chunks))) {
    events.push(event);
  }
  return events;
};

const textChunk = (content: string) => ({
  choices: [{ index: 0, delta: { content } }],
});

const toolFragment = (
  index: number,
  fragment: { id?: string; name?: string; arguments?: string },
) => ({
  choices: [
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index,
            id: fragment.id,
            type: "function",
            function: { name: fragment.name, arguments: fragment.arguments },
          },
        ],
      },
    },
  ],
});

const finishChunk = (reason: string) => ({
  choices: [{ index: 0, delta: {}, finish_reason: reason }],
});

const usageChunk = {
  choices: [],
  usage: { prompt_tokens: 12, completion_tokens: 34 },
};

describe("toStreamEvents", () => {
  test("yields the text deltas in order and then the finish event", async () => {
    const events = await collect([
      textChunk("Hello"),
      textChunk(", "),
      textChunk("world"),
      finishChunk("stop"),
      usageChunk,
    ]);

    expect(events).toEqual([
      { type: "text-delta", delta: "Hello" },
      { type: "text-delta", delta: ", " },
      { type: "text-delta", delta: "world" },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 12, outputTokens: 34 },
      },
    ]);
  });

  test("skips empty and missing text deltas", async () => {
    const events = await collect([
      textChunk(""),
      { choices: [{ index: 0, delta: { content: null } }] },
      { choices: [{ index: 0, delta: {} }] },
      finishChunk("stop"),
    ]);

    expect(events).toEqual([{ type: "finish", finishReason: "stop" }]);
  });

  test("assembles a tool call split across fragments", async () => {
    const events = await collect([
      toolFragment(0, { id: "call-1", name: "weather", arguments: "" }),
      toolFragment(0, { arguments: '{"city":' }),
      toolFragment(0, { arguments: '"Tokyo"' }),
      toolFragment(0, { arguments: "}" }),
      finishChunk("tool_calls"),
    ]);

    expect(events).toEqual([
      {
        type: "tool-call",
        toolCall: {
          id: "call-1",
          name: "weather",
          arguments: { city: "Tokyo" },
        },
      },
      { type: "finish", finishReason: "tool_calls" },
    ]);
  });

  test("yields interleaved tool calls in index order", async () => {
    const events = await collect([
      toolFragment(1, { id: "call-2", name: "clock", arguments: '{"tz":' }),
      toolFragment(0, { id: "call-1", name: "weather", arguments: '{"city":' }),
      toolFragment(1, { arguments: '"UTC"}' }),
      toolFragment(0, { arguments: '"Tokyo"}' }),
      finishChunk("tool_calls"),
    ]);

    expect(events).toEqual([
      {
        type: "tool-call",
        toolCall: {
          id: "call-1",
          name: "weather",
          arguments: { city: "Tokyo" },
        },
      },
      {
        type: "tool-call",
        toolCall: { id: "call-2", name: "clock", arguments: { tz: "UTC" } },
      },
      { type: "finish", finishReason: "tool_calls" },
    ]);
  });

  test("yields the text first and the tool calls afterwards", async () => {
    const events = await collect([
      textChunk("checking"),
      toolFragment(0, { id: "call-1", name: "weather", arguments: "{}" }),
      textChunk(" now"),
      finishChunk("tool_calls"),
      usageChunk,
    ]);

    expect(events).toEqual([
      { type: "text-delta", delta: "checking" },
      { type: "text-delta", delta: " now" },
      {
        type: "tool-call",
        toolCall: { id: "call-1", name: "weather", arguments: {} },
      },
      {
        type: "finish",
        finishReason: "tool_calls",
        usage: { inputTokens: 12, outputTokens: 34 },
      },
    ]);
  });

  test("reads empty tool call arguments as an empty object", async () => {
    const events = await collect([
      toolFragment(0, { id: "call-1", name: "ping" }),
      finishChunk("tool_calls"),
    ]);

    expect(events[0]).toEqual({
      type: "tool-call",
      toolCall: { id: "call-1", name: "ping", arguments: {} },
    });
  });

  test("finishes without usage when no usage chunk arrives", async () => {
    const events = await collect([textChunk("hi"), finishChunk("stop")]);

    expect(events).toEqual([
      { type: "text-delta", delta: "hi" },
      { type: "finish", finishReason: "stop" },
    ]);
    expect(events[1]).not.toHaveProperty("usage");
  });

  test("falls back to other when no finish reason arrives", async () => {
    const events = await collect([textChunk("hi")]);

    expect(events).toEqual([
      { type: "text-delta", delta: "hi" },
      { type: "finish", finishReason: "other" },
    ]);
  });

  test.each([
    ["length", "length"],
    ["content_filter", "other"],
  ])("maps the finish reason %s to %s", async (reason, expected) => {
    const events = await collect([finishChunk(reason)]);

    expect(events).toEqual([{ type: "finish", finishReason: expected }]);
  });

  test("throws a ToolArgumentsError when the arguments are not JSON", async () => {
    const error = await collect([
      toolFragment(0, { id: "call-1", name: "weather", arguments: "{ not" }),
      toolFragment(0, { arguments: " json" }),
      finishChunk("tool_calls"),
    ]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ToolArgumentsError);
    const toolArgumentsError = error as ToolArgumentsError;
    expect(toolArgumentsError.toolCallId).toBe("call-1");
    expect(toolArgumentsError.toolName).toBe("weather");
    expect(toolArgumentsError.raw).toBe("{ not json");
    expect(toolArgumentsError.cause).toBeInstanceOf(SyntaxError);
  });

  test("throws a ProviderHttpError when a payload is not JSON", async () => {
    const error = await collect([textChunk("hi"), "<html>"]).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderHttpError);
    const httpError = error as ProviderHttpError;
    expect(httpError.message).toBe("OpenRouter stream chunk is not JSON");
    expect(httpError.status).toBe(200);
    expect(httpError.body).toBe("<html>");
    expect(httpError.cause).toBeInstanceOf(SyntaxError);
  });

  test("passes an error from the payload source through untouched", async () => {
    const failure = new Error("connection reset");
    const payloads = (async function* () {
      yield JSON.stringify(textChunk("hi"));
      throw failure;
    })();

    const events: StreamEvent[] = [];
    const error = await (async () => {
      for await (const event of toStreamEvents(payloads)) events.push(event);
    })().catch((caught: unknown) => caught);

    expect(error).toBe(failure);
    expect(events).toEqual([{ type: "text-delta", delta: "hi" }]);
  });
});
