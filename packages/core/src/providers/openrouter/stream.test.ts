import { describe, expect, test } from "vitest";
import { ProviderHttpError, ToolArgumentsError } from "../errors.js";
import type { StreamEvent } from "../types.js";
import { toStreamEvents } from "./stream.js";

async function* payloadsOf(...payloads: unknown[]): AsyncGenerator<string> {
  for (const payload of payloads) {
    yield typeof payload === "string" ? payload : JSON.stringify(payload);
  }
}

const collect = async (payloads: AsyncIterable<string>): Promise<StreamEvent[]> => {
  const events: StreamEvent[] = [];
  for await (const event of toStreamEvents(payloads)) {
    events.push(event);
  }
  return events;
};

const failure = async (payloads: AsyncIterable<string>): Promise<unknown> =>
  collect(payloads).then(
    () => undefined,
    (caught: unknown) => caught,
  );

const text = (content: string, finishReason: string | null = null) => ({
  choices: [{ delta: { content }, finish_reason: finishReason }],
});

const toolFragment = (
  index: number,
  fragment: { id?: string; name?: string; arguments?: string },
) => ({
  choices: [
    {
      delta: {
        tool_calls: [
          {
            index,
            ...(fragment.id === undefined ? {} : { id: fragment.id, type: "function" }),
            function: {
              ...(fragment.name === undefined ? {} : { name: fragment.name }),
              ...(fragment.arguments === undefined ? {} : { arguments: fragment.arguments }),
            },
          },
        ],
      },
      finish_reason: null,
    },
  ],
});

const finish = (finishReason: string) => ({
  choices: [{ delta: {}, finish_reason: finishReason }],
});

const usage = { choices: [], usage: { prompt_tokens: 12, completion_tokens: 34 } };

describe("toStreamEvents", () => {
  test("yields text deltas in order, then finish with the reason and usage", async () => {
    const events = await collect(
      payloadsOf(
        { choices: [{ delta: { role: "assistant", content: "" }, finish_reason: null }] },
        text("24 "),
        text("degrees"),
        text("", "stop"),
        usage,
      ),
    );

    expect(events).toEqual([
      { type: "text-delta", delta: "24 " },
      { type: "text-delta", delta: "degrees" },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 12, outputTokens: 34 },
      },
    ]);
  });

  test("assembles one tool call split across four fragments", async () => {
    const events = await collect(
      payloadsOf(
        toolFragment(0, { id: "call-1", name: "weather", arguments: "" }),
        toolFragment(0, { arguments: '{"ci' }),
        toolFragment(0, { arguments: 'ty":"To' }),
        toolFragment(0, { arguments: 'kyo"}' }),
        finish("tool_calls"),
      ),
    );

    expect(events).toEqual([
      {
        type: "tool-call",
        toolCall: { id: "call-1", name: "weather", arguments: { city: "Tokyo" } },
      },
      { type: "finish", finishReason: "tool_calls" },
    ]);
  });

  test("yields interleaved tool calls in index order", async () => {
    const events = await collect(
      payloadsOf(
        toolFragment(1, { id: "call-b", name: "time", arguments: '{"zone"' }),
        toolFragment(0, { id: "call-a", name: "weather", arguments: '{"city"' }),
        toolFragment(1, { arguments: ':"JST"}' }),
        toolFragment(0, { arguments: ':"Tokyo"}' }),
        finish("tool_calls"),
      ),
    );

    expect(events).toEqual([
      {
        type: "tool-call",
        toolCall: { id: "call-a", name: "weather", arguments: { city: "Tokyo" } },
      },
      {
        type: "tool-call",
        toolCall: { id: "call-b", name: "time", arguments: { zone: "JST" } },
      },
      { type: "finish", finishReason: "tool_calls" },
    ]);
  });

  test("yields text first, then tool calls, then finish", async () => {
    const events = await collect(
      payloadsOf(
        text("Checking "),
        text("the weather."),
        toolFragment(0, { id: "call-1", name: "weather", arguments: '{"city":' }),
        toolFragment(0, { arguments: '"Tokyo"}' }),
        finish("tool_calls"),
        usage,
      ),
    );

    expect(events).toEqual([
      { type: "text-delta", delta: "Checking " },
      { type: "text-delta", delta: "the weather." },
      {
        type: "tool-call",
        toolCall: { id: "call-1", name: "weather", arguments: { city: "Tokyo" } },
      },
      {
        type: "finish",
        finishReason: "tool_calls",
        usage: { inputTokens: 12, outputTokens: 34 },
      },
    ]);
  });

  test("yields finish without usage when no usage chunk arrives", async () => {
    const events = await collect(payloadsOf(text("hi", "stop")));

    const last = events.at(-1);
    expect(last).toEqual({ type: "finish", finishReason: "stop" });
    expect(last).not.toHaveProperty("usage");
  });

  test("uses other when no finish reason arrives", async () => {
    const events = await collect(payloadsOf(text("hi")));

    expect(events.at(-1)).toEqual({ type: "finish", finishReason: "other" });
  });

  test("reads empty tool call arguments as an empty object", async () => {
    const events = await collect(
      payloadsOf(
        toolFragment(0, { id: "call-1", name: "now", arguments: "" }),
        finish("tool_calls"),
      ),
    );

    expect(events[0]).toEqual({
      type: "tool-call",
      toolCall: { id: "call-1", name: "now", arguments: {} },
    });
  });

  test("throws a ToolArgumentsError when the assembled arguments are not JSON", async () => {
    const error = await failure(
      payloadsOf(
        toolFragment(0, { id: "call-1", name: "weather", arguments: "{ not" }),
        toolFragment(0, { arguments: " json" }),
        finish("tool_calls"),
      ),
    );

    expect(error).toBeInstanceOf(ToolArgumentsError);
    const toolArgumentsError = error as ToolArgumentsError;
    expect(toolArgumentsError.toolCallId).toBe("call-1");
    expect(toolArgumentsError.toolName).toBe("weather");
    expect(toolArgumentsError.raw).toBe("{ not json");
    expect(toolArgumentsError.cause).toBeInstanceOf(SyntaxError);
  });

  test("throws a ProviderHttpError when a payload is not JSON", async () => {
    const error = await failure(payloadsOf(text("hi"), "<html>oops</html>"));

    expect(error).toBeInstanceOf(ProviderHttpError);
    const providerError = error as ProviderHttpError;
    expect(providerError.status).toBe(200);
    expect(providerError.body).toBe("<html>oops</html>");
  });
});
