import type {
  GenerateResponse,
  Message,
  Provider,
  StreamEvent,
  Tool,
  ToolSchema,
} from "@mg/core";
import { defineTool } from "@mg/core";
import type { Gate, Verdict } from "@mg/gate";
import type { TraceAttributes, TraceSpan } from "@mg/harness";
import { describe, expect, test, vi } from "vitest";
import { createSubagent } from "./subagent.js";

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

const stubTool = (
  name: string,
  execute: Tool["execute"] = async () => `${name}-result`,
): Tool => defineTool({ name, input: stubSchema(), execute });

const scriptedProvider = (
  responses: readonly GenerateResponse[],
): { provider: Provider; requests: Message[][] } => {
  let index = 0;
  const requests: Message[][] = [];
  const provider: Provider = {
    generate: async (request) => {
      requests.push([...request.messages]);
      const response = responses[index];
      index++;
      if (!response)
        throw new Error("scriptedProvider: no scripted response left");
      return response;
    },
    stream: () => {
      throw new Error("scriptedProvider: stream is not scripted");
    },
  };
  return { provider, requests };
};

const throwingProvider = (error: Error): Provider => ({
  generate: async () => {
    throw error;
  },
  stream: () => {
    throw new Error("throwingProvider: stream is not scripted");
  },
});

class RecordingSpan implements TraceSpan {
  readonly name: string;
  readonly children: RecordingSpan[] = [];

  constructor(name: string) {
    this.name = name;
  }

  startSpan(name: string): TraceSpan {
    const child = new RecordingSpan(name);
    this.children.push(child);
    return child;
  }

  startRoot(name: string): TraceSpan {
    return new RecordingSpan(name);
  }

  setAttributes(_attributes: TraceAttributes): void {}
  addEvent(_name: string, _attributes?: TraceAttributes): void {}
  end(_error?: unknown): void {}
}

describe("createSubagent", () => {
  test("exposes the configured name and description, with an input schema that requires only a described prompt", () => {
    const subagent = createSubagent({
      name: "researcher",
      description: "Researches a topic",
      provider: scriptedProvider([]).provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
    });

    expect(subagent.name).toBe("researcher");
    expect(subagent.description).toBe("Researches a topic");
    const schema = subagent.input["~standard"].jsonSchema.input({
      target: "draft-07",
    });
    expect(schema).toMatchObject({
      required: ["prompt"],
      properties: {
        prompt: {
          description:
            "The task for the subagent. It starts with no memory of this conversation, so include everything it needs.",
        },
      },
    });
  });

  test("starts the child with a system message and the request as the user message, returning the child's final text", async () => {
    const { provider, requests } = scriptedProvider([
      {
        parts: [{ type: "text", text: "answer" }],
        finishReason: "stop",
      },
    ]);
    const subagent = createSubagent({
      name: "researcher",
      description: "Researches a topic",
      system: "You research.",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
    });

    const result = await subagent.start({ prompt: "find x" }, {});

    expect(result).toBe("answer");
    expect(requests[0]).toEqual([
      { role: "system", content: "You research." },
      { role: "user", content: "find x" },
    ]);
  });

  test("starts the child with only the user message when no system prompt is configured", async () => {
    const { provider, requests } = scriptedProvider([
      {
        parts: [{ type: "text", text: "answer" }],
        finishReason: "stop",
      },
    ]);
    const subagent = createSubagent({
      name: "researcher",
      description: "Researches a topic",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
    });

    await subagent.start({ prompt: "find x" }, {});

    expect(requests[0]).toEqual([{ role: "user", content: "find x" }]);
  });

  test("returns a fixed sentence when the child stops with no final text", async () => {
    const { provider } = scriptedProvider([
      { parts: [], finishReason: "stop" },
    ]);
    const subagent = createSubagent({
      name: "researcher",
      description: "Researches a topic",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
    });

    const result = await subagent.start({ prompt: "find x" }, {});

    expect(result).toBe(
      "[empty] The subagent finished without a final message.",
    );
  });

  test("reports the turn limit and the last text when the child runs out of turns mid tool call", async () => {
    const { provider } = scriptedProvider([
      {
        parts: [
          { type: "text", text: "thinking" },
          {
            type: "tool-call",
            id: "call-1",
            name: "echo",
            arguments: {},
          },
        ],
        finishReason: "tool_calls",
      },
    ]);
    const subagent = createSubagent({
      name: "researcher",
      description: "Researches a topic",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
    });

    const result = await subagent.start({ prompt: "find x" }, {});

    expect(result).toBe(
      "[incomplete] The subagent reached its turn limit of 1 before finishing. No final answer was produced. Its last message before the limit follows:\nthinking",
    );
  });

  test("reports the turn limit as empty when the child produced no text before the limit", async () => {
    const { provider } = scriptedProvider([
      {
        parts: [
          {
            type: "tool-call",
            id: "call-1",
            name: "echo",
            arguments: {},
          },
        ],
        finishReason: "tool_calls",
      },
    ]);
    const subagent = createSubagent({
      name: "researcher",
      description: "Researches a topic",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
    });

    const result = await subagent.start({ prompt: "find x" }, {});

    expect(result).toBe(
      "[incomplete] The subagent reached its turn limit of 1 before finishing. No final answer was produced. Its last message before the limit was empty.",
    );
  });

  test("reports a cut-off length limit with the cut-off text", async () => {
    const { provider } = scriptedProvider([
      {
        parts: [{ type: "text", text: "partial ans" }],
        finishReason: "length",
      },
    ]);
    const subagent = createSubagent({
      name: "researcher",
      description: "Researches a topic",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
    });

    const result = await subagent.start({ prompt: "find x" }, {});

    expect(result).toBe(
      "[incomplete] The subagent's output was cut off at the model's length limit. The cut-off text follows:\npartial ans",
    );
  });

  test("reports a cut-off length limit as empty when there is no text", async () => {
    const { provider } = scriptedProvider([
      { parts: [], finishReason: "length" },
    ]);
    const subagent = createSubagent({
      name: "researcher",
      description: "Researches a topic",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
    });

    const result = await subagent.start({ prompt: "find x" }, {});

    expect(result).toBe(
      "[incomplete] The subagent's output was cut off at the model's length limit. The cut-off text was empty.",
    );
  });

  test("propagates the error the provider throws", async () => {
    const error = new Error("provider down");
    const subagent = createSubagent({
      name: "researcher",
      description: "Researches a topic",
      provider: throwingProvider(error),
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
    });

    await expect(
      subagent.start({ prompt: "find x" }, {}),
    ).rejects.toThrow(error);
  });

  test("runs the child's tool calls through the configured gate, and does not execute a denied call", async () => {
    const execute = vi.fn(async () => "echo-result");
    const echoTool = stubTool("echo", execute);
    const judge = vi.fn(async (): Promise<Verdict> => ({
      allowed: false,
      reason: "no",
    }));
    const gate: Gate = { judge };
    const { provider } = scriptedProvider([
      {
        parts: [
          {
            type: "tool-call",
            id: "call-1",
            name: "echo",
            arguments: {},
          },
        ],
        finishReason: "tool_calls",
      },
      { parts: [{ type: "text", text: "ok" }], finishReason: "stop" },
    ]);
    const subagent = createSubagent({
      name: "researcher",
      description: "Researches a topic",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 2, stream: false },
      tools: [echoTool],
      gate,
    });

    const result = await subagent.start({ prompt: "find x" }, {});

    expect(execute).not.toHaveBeenCalled();
    expect(result).toBe("ok");
  });

  test("nests the child harness's span under the span received in context", async () => {
    const { provider } = scriptedProvider([
      {
        parts: [{ type: "text", text: "answer" }],
        finishReason: "stop",
      },
    ]);
    const subagent = createSubagent({
      name: "researcher",
      description: "Researches a topic",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
    });
    const t = new RecordingSpan("t");

    await subagent.start({ prompt: "find x" }, { trace: t });

    expect(t.children.map((child) => child.name)).toEqual([
      "mg.harness",
    ]);
  });

  test("throws an abort error and never calls the provider when the signal starts aborted", async () => {
    const generate = vi.fn(async (): Promise<GenerateResponse> => {
      throw new Error("should not be called");
    });
    const provider: Provider = {
      generate,
      stream: (): AsyncIterable<StreamEvent> => {
        throw new Error("not scripted");
      },
    };
    const subagent = createSubagent({
      name: "researcher",
      description: "Researches a topic",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      subagent.start(
        { prompt: "find x" },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(generate).not.toHaveBeenCalled();
  });

  test("throws RangeError at assembly when the turn limit is below one", () => {
    expect(() =>
      createSubagent({
        name: "researcher",
        description: "Researches a topic",
        provider: scriptedProvider([]).provider,
        harness: {
          kind: "loop",
          model: "m",
          maxTurns: 0,
          stream: false,
        },
      }),
    ).toThrow(new RangeError("maxTurns must be >= 1, got 0"));
  });
});
