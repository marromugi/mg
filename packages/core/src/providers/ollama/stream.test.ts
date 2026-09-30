import { describe, expect, test } from "vitest";
import { ProviderHttpError } from "../errors.js";
import type { StreamEvent } from "../types.js";
import { toStreamEvents } from "./stream.js";

const sequentialIds = (): (() => string) => {
  let count = 0;
  return () => {
    count += 1;
    return `u${count}`;
  };
};

const linesOf = async function* (
  chunks: unknown[],
): AsyncGenerator<string> {
  for (const chunk of chunks) {
    yield typeof chunk === "string" ? chunk : JSON.stringify(chunk);
  }
};

const collect = async (chunks: unknown[]): Promise<StreamEvent[]> => {
  const events: StreamEvent[] = [];
  for await (const event of toStreamEvents(
    linesOf(chunks),
    sequentialIds(),
  )) {
    events.push(event);
  }
  return events;
};

const textChunk = (content: string, thinking?: string) => ({
  message: { content, ...(thinking !== undefined && { thinking }) },
  done: false,
});

const toolCallChunk = (name: string, args: unknown, id?: string) => ({
  message: {
    content: "",
    tool_calls: [{ id, function: { name, arguments: args } }],
  },
  done: false,
});

const doneChunk = (
  reason: string,
  usage?: { prompt_eval_count: number; eval_count: number },
) => ({
  message: { content: "" },
  done: true,
  done_reason: reason,
  ...usage,
});

describe("toStreamEvents", () => {
  test("yields the text deltas in order and then the finish event", async () => {
    const events = await collect([
      textChunk("Hello"),
      textChunk(", "),
      textChunk("world"),
      doneChunk("stop"),
    ]);

    expect(events).toEqual([
      { type: "text-delta", delta: "Hello" },
      { type: "text-delta", delta: ", " },
      { type: "text-delta", delta: "world" },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  test("yields reasoning-delta and skips empty content", async () => {
    const events = await collect([
      textChunk("", "let me think"),
      textChunk("answer"),
      doneChunk("stop"),
    ]);

    expect(events).toEqual([
      { type: "reasoning-delta", delta: "let me think" },
      { type: "text-delta", delta: "answer" },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  test("yields reasoning-delta before text-delta within the same chunk", async () => {
    const events = await collect([
      textChunk("answer", "let me think"),
      doneChunk("stop"),
    ]);

    expect(events).toEqual([
      { type: "reasoning-delta", delta: "let me think" },
      { type: "text-delta", delta: "answer" },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  test("skips an empty thinking string", async () => {
    const events = await collect([
      textChunk("answer", ""),
      doneChunk("stop"),
    ]);

    expect(events).toEqual([
      { type: "text-delta", delta: "answer" },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  test("yields a tool call immediately, without accumulation", async () => {
    const events = await collect([
      toolCallChunk("weather", { city: "Tokyo" }, "call-1"),
    ]);

    expect(events[0]).toEqual({
      type: "tool-call",
      toolCall: {
        id: "u1",
        name: "weather",
        arguments: { city: "Tokyo" },
      },
    });
  });

  test("gives each tool call the next generated id, whether or not the chunk had one, when two arrive in separate chunks, then finish with tool_calls", async () => {
    const events = await collect([
      toolCallChunk("weather", { city: "Tokyo" }, "call-1"),
      toolCallChunk("clock", { tz: "UTC" }),
      doneChunk("stop"),
    ]);

    expect(events).toEqual([
      {
        type: "tool-call",
        toolCall: {
          id: "u1",
          name: "weather",
          arguments: { city: "Tokyo" },
        },
      },
      {
        type: "tool-call",
        toolCall: {
          id: "u2",
          name: "clock",
          arguments: { tz: "UTC" },
        },
      },
      { type: "finish", finishReason: "tool_calls" },
    ]);
  });

  test("yields usage on finish when present", async () => {
    const events = await collect([
      textChunk("hi"),
      doneChunk("stop", { prompt_eval_count: 12, eval_count: 34 }),
    ]);

    expect(events).toEqual([
      { type: "text-delta", delta: "hi" },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 12, outputTokens: 34 },
      },
    ]);
  });

  test("finishes without usage when it is missing", async () => {
    const events = await collect([textChunk("hi"), doneChunk("stop")]);

    expect(events[1]).not.toHaveProperty("usage");
  });

  test("stops reading after the done chunk", async () => {
    const events = await collect([
      textChunk("hi"),
      doneChunk("stop"),
      textChunk("should not appear"),
    ]);

    expect(events).toEqual([
      { type: "text-delta", delta: "hi" },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  test("yields finish as other when the stream ends without done", async () => {
    const events = await collect([textChunk("hi")]);

    expect(events).toEqual([
      { type: "text-delta", delta: "hi" },
      { type: "finish", finishReason: "other" },
    ]);
    expect(events[1]).not.toHaveProperty("usage");
  });

  test("throws a ProviderHttpError when a line is not JSON", async () => {
    const error = await collect([textChunk("hi"), "<html>"]).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderHttpError);
    const httpError = error as ProviderHttpError;
    expect(httpError.message).toBe("Ollama stream chunk is not JSON");
    expect(httpError.status).toBe(200);
    expect(httpError.body).toBe("<html>");
    expect(httpError.cause).toBeInstanceOf(SyntaxError);
  });

  test("throws a ProviderHttpError when a line is JSON but not an object", async () => {
    const error = await collect(["[1, 2, 3]"]).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderHttpError);
    const httpError = error as ProviderHttpError;
    expect(httpError.message).toBe("Ollama stream chunk is not JSON");
    expect(httpError.body).toBe("[1, 2, 3]");
  });

  test("throws a ProviderHttpError when a line carries an error field", async () => {
    const payload = JSON.stringify({ error: "model not found" });

    const error = await collect([textChunk("hi"), payload]).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderHttpError);
    const httpError = error as ProviderHttpError;
    expect(httpError.message).toBe("Ollama stream failed");
    expect(httpError.status).toBe(200);
    expect(httpError.body).toBe(payload);
  });
});
