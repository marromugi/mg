import { describe, expect, it } from "vitest";
import type {
  GenerateRequest,
  GenerateResponse,
  Provider,
  StreamEvent,
} from "@mg/core";
import { ATTR, SPAN } from "./vocabulary.js";
import { traceProvider } from "./provider.js";
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
      generate: async () => {
        startedBefore = root.children[0];
        return {
          content: "hello",
          toolCalls: [],
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
    });
  });

  it("records finish reason, output messages and returns the response unchanged", async () => {
    const root = new RecordingSpan("root");
    const response: GenerateResponse = {
      content: "hello there",
      toolCalls: [{ id: "1", name: "x", arguments: {} }],
      finishReason: "stop",
      usage: { inputTokens: 3, outputTokens: 5 },
    };
    const provider: Provider = {
      generate: async () => response,
      stream: async function* () {},
    };

    const result = await traceProvider(provider, root).generate(request);
    const span = root.children[0];

    expect(result).toBe(response);
    expect(span?.mergedAttributes[ATTR.llmFinishReason]).toBe("stop");
    expect(span?.mergedAttributes[ATTR.llmInputTokens]).toBe(3);
    expect(span?.mergedAttributes[ATTR.llmOutputTokens]).toBe(5);
    expect(span?.mergedAttributes[ATTR.llmOutputMessages]).toBe(
      JSON.stringify([
        {
          role: "assistant",
          content: "hello there",
          toolCalls: response.toolCalls,
        },
      ]),
    );
    expect(span?.endCalls).toEqual([undefined]);
  });

  it("omits token attributes when usage is absent", async () => {
    const root = new RecordingSpan("root");
    const provider: Provider = {
      generate: async () => ({
        content: "no usage",
        toolCalls: [],
        finishReason: "stop",
      }),
      stream: async function* () {},
    };

    await traceProvider(provider, root).generate(request);
    const span = root.children[0];

    expect(span?.mergedAttributes[ATTR.llmInputTokens]).toBeUndefined();
    expect(span?.mergedAttributes[ATTR.llmOutputTokens]).toBeUndefined();
  });

  it("ends the span with the error and rethrows it unchanged when the provider throws", async () => {
    const root = new RecordingSpan("root");
    const error = new Error("boom");
    const provider: Provider = {
      generate: async () => {
        throw error;
      },
      stream: async function* () {},
    };

    await expect(traceProvider(provider, root).generate(request)).rejects.toBe(
      error,
    );

    const span = root.children[0];
    expect(span?.endCalls).toEqual([error]);
  });

  it("starts no span until generate is called", () => {
    const root = new RecordingSpan("root");
    const provider: Provider = {
      generate: async () => ({
        content: "",
        toolCalls: [],
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
      generate: async () => {
        throw new Error("unused");
      },
      stream: async function* () {
        for (const event of streamEvents) {
          yield event;
        }
      },
    };

    const events = await collect(traceProvider(provider, root).stream(request));

    expect(events).toEqual(streamEvents);
  });

  it("records stream=true, and after completion the accumulated output and tokens", async () => {
    const root = new RecordingSpan("root");
    const provider: Provider = {
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
    expect(span?.mergedAttributes[ATTR.llmFinishReason]).toBe("tool_calls");
    expect(span?.mergedAttributes[ATTR.llmInputTokens]).toBe(2);
    expect(span?.mergedAttributes[ATTR.llmOutputTokens]).toBe(4);
    expect(span?.mergedAttributes[ATTR.llmOutputMessages]).toBe(
      JSON.stringify([
        {
          role: "assistant",
          content: "hello",
          toolCalls: [{ id: "1", name: "x", arguments: { a: 1 } }],
        },
      ]),
    );
    expect(span?.endCalls).toEqual([undefined]);
  });

  it("ends the span with the error and rethrows it when the inner iterable throws mid-way", async () => {
    const root = new RecordingSpan("root");
    const error = new Error("stream boom");
    const provider: Provider = {
      generate: async () => {
        throw new Error("unused");
      },
      stream: async function* () {
        yield streamEvents[0] as StreamEvent;
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

  it("starts no span until iteration begins", () => {
    const root = new RecordingSpan("root");
    const provider: Provider = {
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
