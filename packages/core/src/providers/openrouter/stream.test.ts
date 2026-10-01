import { describe, expect, test } from "vitest";
import {
  ProviderResponseError,
  ToolArgumentsError,
} from "../errors.js";
import { OpenRouterHttpError } from "./http-error.js";
import type { StreamEvent } from "../types.js";
import { toStreamEvents } from "./stream.js";

const payloadsOf = async function* (
  chunks: unknown[],
): AsyncGenerator<string> {
  for (const chunk of chunks) {
    yield typeof chunk === "string" ? chunk : JSON.stringify(chunk);
  }
};

const sequentialIds = (): (() => string) => {
  let count = 0;
  return () => `u${++count}`;
};

const orCarry = (id: string) => ({
  provider: "openrouter",
  data: { id },
});

const collect = async (chunks: unknown[]): Promise<StreamEvent[]> => {
  const events: StreamEvent[] = [];
  for await (const event of toStreamEvents(
    payloadsOf(chunks),
    sequentialIds(),
  )) {
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
            function: {
              name: fragment.name,
              arguments: fragment.arguments,
            },
          },
        ],
      },
    },
  ],
});

const finishChunk = (reason: string) => ({
  choices: [{ index: 0, delta: {}, finish_reason: reason }],
});

const reasoningChunk = (reasoning: string) => ({
  choices: [{ index: 0, delta: { reasoning } }],
});

const reasoningDetailsChunk = (details: unknown[]) => ({
  choices: [{ index: 0, delta: { reasoning_details: details } }],
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

  test("yields the reasoning deltas in order before the text deltas", async () => {
    const events = await collect([
      reasoningChunk("Let"),
      reasoningChunk(" me think"),
      textChunk("24"),
      finishChunk("stop"),
    ]);

    expect(events).toEqual([
      { type: "reasoning-delta", delta: "Let" },
      { type: "reasoning-delta", delta: " me think" },
      { type: "text-delta", delta: "24" },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  test("skips empty and missing reasoning deltas", async () => {
    const events = await collect([
      reasoningChunk(""),
      { choices: [{ index: 0, delta: { reasoning: null } }] },
      { choices: [{ index: 0, delta: {} }] },
      finishChunk("stop"),
    ]);

    expect(events).toEqual([{ type: "finish", finishReason: "stop" }]);
  });

  test("accumulates reasoning_details fragments into a single carry before the text delta that follows", async () => {
    const first = {
      type: "reasoning.text",
      text: "Let me",
      id: "r1",
      format: "anthropic-claude-v1",
      index: 0,
    };
    const second = {
      type: "reasoning.text",
      text: " think",
      id: "r1",
      format: "anthropic-claude-v1",
      index: 0,
    };
    const events = await collect([
      reasoningDetailsChunk([first]),
      reasoningDetailsChunk([second]),
      textChunk("24"),
      finishChunk("stop"),
    ]);

    expect(events).toEqual([
      {
        type: "reasoning-delta",
        delta: "",
        carry: {
          provider: "openrouter",
          data: [first, second],
        },
      },
      { type: "text-delta", delta: "24" },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  test("keeps the first non-empty id of a tool call as its carry", async () => {
    const events = await collect([
      toolFragment(0, { id: "", name: "weather" }),
      toolFragment(0, { id: "call_1", arguments: '{"city":' }),
      toolFragment(0, { arguments: '"Tokyo"}' }),
      finishChunk("tool_calls"),
    ]);

    expect(events).toEqual([
      {
        type: "tool-call",
        toolCall: {
          id: "u1",
          name: "weather",
          arguments: { city: "Tokyo" },
        },
        carry: orCarry("call_1"),
      },
      { type: "finish", finishReason: "tool_calls" },
    ]);
  });

  test("sets no carry when the tool call has no id", async () => {
    const events = await collect([
      toolFragment(0, { name: "weather", arguments: "{}" }),
      finishChunk("tool_calls"),
    ]);

    expect(events[0]).toEqual({
      type: "tool-call",
      toolCall: { id: "u1", name: "weather", arguments: {} },
    });
  });

  test("adds nothing when a later fragment repeats the same id", async () => {
    const events = await collect([
      toolFragment(0, {
        id: "call_1",
        name: "weather",
        arguments: '{"city":',
      }),
      toolFragment(0, { id: "call_1", arguments: '"Tokyo"}' }),
      finishChunk("tool_calls"),
    ]);

    expect(events).toEqual([
      {
        type: "tool-call",
        toolCall: {
          id: "u1",
          name: "weather",
          arguments: { city: "Tokyo" },
        },
        carry: orCarry("call_1"),
      },
      { type: "finish", finishReason: "tool_calls" },
    ]);
  });

  test("throws a ProviderResponseError when fragments of one call carry two ids", async () => {
    const error = await collect([
      toolFragment(0, { id: "call_1", name: "weather" }),
      toolFragment(0, { id: "call_2", arguments: "{}" }),
      finishChunk("tool_calls"),
    ]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderResponseError);
    expect(
      ((error as ProviderResponseError).cause as OpenRouterHttpError)
        .status,
    ).toBe(200);
  });

  test("emits the pending carry before finish when no text or tool call follows", async () => {
    const detail = {
      type: "reasoning.text",
      text: "Let me think",
      id: "r1",
      format: "anthropic-claude-v1",
      index: 0,
    };
    const events = await collect([
      reasoningDetailsChunk([detail]),
      finishChunk("stop"),
    ]);

    expect(events).toEqual([
      {
        type: "reasoning-delta",
        delta: "",
        carry: { provider: "openrouter", data: [detail] },
      },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  test("emits the pending carry before the tool calls that follow", async () => {
    const detail = {
      type: "reasoning.text",
      text: "Let me think",
      id: "r1",
      format: "anthropic-claude-v1",
      index: 0,
    };
    const events = await collect([
      reasoningDetailsChunk([detail]),
      toolFragment(0, {
        id: "call-1",
        name: "weather",
        arguments: "{}",
      }),
      finishChunk("tool_calls"),
    ]);

    expect(events).toEqual([
      {
        type: "reasoning-delta",
        delta: "",
        carry: { provider: "openrouter", data: [detail] },
      },
      {
        type: "tool-call",
        toolCall: { id: "u1", name: "weather", arguments: {} },
        carry: orCarry("call-1"),
      },
      { type: "finish", finishReason: "tool_calls" },
    ]);
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
          id: "u1",
          name: "weather",
          arguments: { city: "Tokyo" },
        },
        carry: orCarry("call-1"),
      },
      { type: "finish", finishReason: "tool_calls" },
    ]);
  });

  test("yields interleaved tool calls in index order", async () => {
    const events = await collect([
      toolFragment(1, {
        id: "call-2",
        name: "clock",
        arguments: '{"tz":',
      }),
      toolFragment(0, {
        id: "call-1",
        name: "weather",
        arguments: '{"city":',
      }),
      toolFragment(1, { arguments: '"UTC"}' }),
      toolFragment(0, { arguments: '"Tokyo"}' }),
      finishChunk("tool_calls"),
    ]);

    expect(events).toEqual([
      {
        type: "tool-call",
        toolCall: {
          id: "u1",
          name: "weather",
          arguments: { city: "Tokyo" },
        },
        carry: orCarry("call-1"),
      },
      {
        type: "tool-call",
        toolCall: {
          id: "u2",
          name: "clock",
          arguments: { tz: "UTC" },
        },
        carry: orCarry("call-2"),
      },
      { type: "finish", finishReason: "tool_calls" },
    ]);
  });

  test("yields the text first and the tool calls afterwards", async () => {
    const events = await collect([
      textChunk("checking"),
      toolFragment(0, {
        id: "call-1",
        name: "weather",
        arguments: "{}",
      }),
      textChunk(" now"),
      finishChunk("tool_calls"),
      usageChunk,
    ]);

    expect(events).toEqual([
      { type: "text-delta", delta: "checking" },
      { type: "text-delta", delta: " now" },
      {
        type: "tool-call",
        toolCall: { id: "u1", name: "weather", arguments: {} },
        carry: orCarry("call-1"),
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
      toolCall: { id: "u1", name: "ping", arguments: {} },
      carry: orCarry("call-1"),
    });
  });

  test("finishes without usage when no usage chunk arrives", async () => {
    const events = await collect([
      textChunk("hi"),
      finishChunk("stop"),
    ]);

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

    expect(events).toEqual([
      { type: "finish", finishReason: expected },
    ]);
  });

  test("throws a ToolArgumentsError when the arguments are not JSON", async () => {
    const error = await collect([
      toolFragment(0, {
        id: "call-1",
        name: "weather",
        arguments: "{ not",
      }),
      toolFragment(0, { arguments: " json" }),
      finishChunk("tool_calls"),
    ]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ToolArgumentsError);
    const toolArgumentsError = error as ToolArgumentsError;
    expect(toolArgumentsError.toolCallId).toBe("u1");
    expect(toolArgumentsError.toolName).toBe("weather");
    expect(toolArgumentsError.raw).toBe("{ not json");
    expect(toolArgumentsError.cause).toBeInstanceOf(SyntaxError);
  });

  test("throws a ProviderResponseError when a payload is not JSON", async () => {
    const error = await collect([textChunk("hi"), "<html>"]).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderResponseError);
    const responseError = error as ProviderResponseError;
    expect(responseError.messageWithoutServiceText).toBe(
      "OpenRouter stream chunk is not JSON: (text from the service left out)",
    );
    const httpError = responseError.cause as OpenRouterHttpError;
    expect(httpError).toBeInstanceOf(OpenRouterHttpError);
    expect(httpError.status).toBe(200);
    expect(httpError.body).toBe("<html>");
    expect(httpError.cause).toBeInstanceOf(SyntaxError);
  });

  test("throws a ProviderResponseError when a payload carries an error instead of choices", async () => {
    const payload = JSON.stringify({
      error: { code: 502, message: "upstream is down" },
    });

    const error = await collect([textChunk("hi"), payload]).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderResponseError);
    const responseError = error as ProviderResponseError;
    expect(responseError.message).toBe(
      `OpenRouter stream chunk has no choices: ${payload}`,
    );
    const httpError = responseError.cause as OpenRouterHttpError;
    expect(httpError.status).toBe(200);
    expect(httpError.body).toBe(payload);
  });

  test("passes an error from the payload source through untouched", async () => {
    const failure = new Error("connection reset");
    const payloads = (async function* () {
      yield JSON.stringify(textChunk("hi"));
      throw failure;
    })();

    const events: StreamEvent[] = [];
    const error = await (async () => {
      for await (const event of toStreamEvents(
        payloads,
        sequentialIds(),
      ))
        events.push(event);
    })().catch((caught: unknown) => caught);

    expect(error).toBe(failure);
    expect(events).toEqual([{ type: "text-delta", delta: "hi" }]);
  });
});
