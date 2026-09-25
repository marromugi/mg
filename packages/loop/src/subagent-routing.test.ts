import type {
  GenerateResponse,
  Message,
  Provider,
  StreamEvent,
  Tool,
  ToolMessage,
  ToolSchema,
} from "@mg/core";
import { defineTool } from "@mg/core";
import type { Gate, Verdict } from "@mg/gate";
import { collect } from "@mg/harness";
import type {
  HarnessEvent,
  Subagent,
  SubagentContext,
  TraceAttributes,
  TraceSpan,
} from "@mg/harness";
import { describe, expect, test, vi } from "vitest";
import { createLoopHarness } from "./loop.js";

class RecordingSpan implements TraceSpan {
  readonly name: string;
  readonly attributes: TraceAttributes;
  readonly children: RecordingSpan[] = [];
  readonly newRoots: RecordingSpan[] = [];
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
    const root = new RecordingSpan(name, attributes);
    this.newRoots.push(root);
    return root;
  }

  setAttributes(): void {}

  addEvent(): void {}

  end(error?: unknown): void {
    this.endCalls.push(error);
  }
}

const collectSpans = (span: RecordingSpan): RecordingSpan[] => [
  span,
  ...span.children.flatMap(collectSpans),
  ...span.newRoots.flatMap(collectSpans),
];

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

const promptSchema = (): ToolSchema => ({
  "~standard": {
    version: 1,
    vendor: "mg-test",
    validate: (value: unknown) => {
      const prompt = (value as { prompt?: unknown } | undefined)
        ?.prompt;
      if (typeof prompt !== "string") {
        return {
          issues: [{ message: "Expected string", path: ["prompt"] }],
        };
      }
      return { value: { prompt } };
    },
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

const stubGate = (judge: Gate["judge"]): Gate => ({ judge });

const toolMessageOf = (
  messages: readonly Message[],
): ToolMessage | undefined =>
  messages.find(
    (message): message is ToolMessage => message.role === "tool",
  );

describe("createLoopHarness with subagents", () => {
  test("the provider's tools list has the tool definition followed by the subagent's name, description and input schema", async () => {
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const echo: Tool = defineTool({
      name: "echo",
      input: stubSchema(),
      execute: async () => "echoed",
    });
    const researcher: Subagent = {
      name: "researcher",
      description: "Researches a topic",
      input: stubSchema(),
      start: async () => "done",
    };
    const harness = createLoopHarness({
      provider,
      model: "m",
      tools: [echo],
      subagents: [researcher],
      maxTurns: 1,
      stream: false,
    });

    await collect(harness({ messages: [] }));

    const request = vi.mocked(provider.generate).mock.calls[0]?.[0];
    expect(request?.tools?.map((tool) => tool.name)).toEqual([
      "echo",
      "researcher",
    ]);
    expect(request?.tools?.[1]?.description).toBe("Researches a topic");
  });

  test("a scripted subagent call is started with the validated input and the harness's signal, and its result becomes the tool message", async () => {
    const controller = new AbortController();
    const received: { input?: unknown; context?: SubagentContext } = {};
    const researcher: Subagent = {
      name: "researcher",
      input: promptSchema(),
      start: async (input, context) => {
        received.input = input;
        received.context = context;
        return "found";
      },
    };
    const provider = stubProvider([
      {
        parts: [
          {
            type: "tool-call",
            id: "c1",
            name: "researcher",
            arguments: { prompt: "find x" },
          },
        ],
        finishReason: "tool_calls",
      },
      { parts: [{ type: "text", text: "ok" }], finishReason: "stop" },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      subagents: [researcher],
      maxTurns: 2,
      stream: false,
    });

    const events: HarnessEvent[] = [];
    for await (const event of harness({
      messages: [],
      signal: controller.signal,
    })) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "tool-result",
      message: { role: "tool", toolCallId: "c1", content: "found" },
    });
    expect(received.input).toEqual({ prompt: "find x" });
    expect(received.context?.signal).toBe(controller.signal);
    expect(
      events.filter((event) => event.type === "tool-call"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "tool-result"),
    ).toHaveLength(1);
  });

  test("a call to a name in neither the tool nor the subagent list produces the ToolNotFoundError message", async () => {
    const researcher: Subagent = {
      name: "researcher",
      input: stubSchema(),
      start: async () => "unused",
    };
    const provider = stubProvider([
      {
        parts: [
          {
            type: "tool-call",
            id: "c1",
            name: "missing",
            arguments: {},
          },
        ],
        finishReason: "tool_calls",
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      subagents: [researcher],
      maxTurns: 1,
      stream: false,
    });

    const result = await collect(harness({ messages: [] }));

    expect(toolMessageOf(result.messages)?.content).toBe(
      "[ToolNotFoundError] No tool named missing for tool call c1",
    );
  });

  test("when the start function throws a named error, the tool message carries that name and message and the run continues to a second turn ending in stop", async () => {
    const researcher: Subagent = {
      name: "researcher",
      input: stubSchema(),
      start: async () => {
        const error = new Error(
          'Failed to open connector "ssh" at index 0',
        );
        error.name = "ConnectorOpenError";
        throw error;
      },
    };
    const provider = stubProvider([
      {
        parts: [
          {
            type: "tool-call",
            id: "c1",
            name: "researcher",
            arguments: {},
          },
        ],
        finishReason: "tool_calls",
      },
      { parts: [{ type: "text", text: "done" }], finishReason: "stop" },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      subagents: [researcher],
      maxTurns: 2,
      stream: false,
    });

    const result = await collect(harness({ messages: [] }));

    expect(toolMessageOf(result.messages)?.content).toBe(
      '[ConnectorOpenError] Failed to open connector "ssh" at index 0',
    );
    expect(result.reason).toBe("stop");
    expect(provider.generate).toHaveBeenCalledTimes(2);
  });

  test("when the start function throws an AbortError, the harness rejects with that same error", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const researcher: Subagent = {
      name: "researcher",
      input: stubSchema(),
      start: async () => {
        throw abortError;
      },
    };
    const provider = stubProvider([
      {
        parts: [
          {
            type: "tool-call",
            id: "c1",
            name: "researcher",
            arguments: {},
          },
        ],
        finishReason: "tool_calls",
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      subagents: [researcher],
      maxTurns: 2,
      stream: false,
    });

    const error = await collect(harness({ messages: [] })).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBe(abortError);
  });

  test("invalid arguments for a subagent call produce a SubagentInputError message whose second line starts with a dash", async () => {
    const researcher: Subagent = {
      name: "researcher",
      input: promptSchema(),
      start: async () => "unused",
    };
    const provider = stubProvider([
      {
        parts: [
          {
            type: "tool-call",
            id: "c1",
            name: "researcher",
            arguments: { prompt: 1 },
          },
        ],
        finishReason: "tool_calls",
      },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      subagents: [researcher],
      maxTurns: 1,
      stream: false,
    });

    const result = await collect(harness({ messages: [] }));

    const lines =
      toolMessageOf(result.messages)?.content.split("\n") ?? [];
    expect(lines[0]).toBe(
      "[SubagentInputError] Invalid arguments for subagent call c1 (researcher)",
    );
    expect(lines[1]?.startsWith("- ")).toBe(true);
  });

  test("a tool and a subagent sharing a name throws at harness creation", () => {
    const provider = stubProvider([]);
    const tool: Tool = defineTool({
      name: "researcher",
      input: stubSchema(),
      execute: async () => "x",
    });
    const subagent: Subagent = {
      name: "researcher",
      input: stubSchema(),
      start: async () => "y",
    };

    expect(() =>
      createLoopHarness({
        provider,
        model: "m",
        tools: [tool],
        subagents: [subagent],
        maxTurns: 1,
      }),
    ).toThrow(
      'Name "researcher" is used by more than one tool or subagent',
    );
  });

  test("two subagents sharing a name throws at harness creation with the same message", () => {
    const provider = stubProvider([]);
    const subagentA: Subagent = {
      name: "researcher",
      input: stubSchema(),
      start: async () => "a",
    };
    const subagentB: Subagent = {
      name: "researcher",
      input: stubSchema(),
      start: async () => "b",
    };

    expect(() =>
      createLoopHarness({
        provider,
        model: "m",
        subagents: [subagentA, subagentB],
        maxTurns: 1,
      }),
    ).toThrow(
      'Name "researcher" is used by more than one tool or subagent',
    );
  });

  test("a gate that denies a subagent call leaves the start function unrun and returns the same denial message as a tool", async () => {
    const start = vi.fn(async () => "found");
    const researcher: Subagent = {
      name: "researcher",
      input: stubSchema(),
      start,
    };
    const provider = stubProvider([
      {
        parts: [
          {
            type: "tool-call",
            id: "c1",
            name: "researcher",
            arguments: {},
          },
        ],
        finishReason: "tool_calls",
      },
    ]);
    const gate = stubGate(async (): Promise<Verdict> => ({
      allowed: false,
      reason: "not now",
    }));
    const harness = createLoopHarness({
      provider,
      model: "m",
      subagents: [researcher],
      maxTurns: 1,
      stream: false,
      gate,
    });

    const result = await collect(harness({ messages: [] }));

    expect(start).not.toHaveBeenCalled();
    expect(toolMessageOf(result.messages)?.content).toBe(
      "[denied] Not executed. The policy gate rejected this action: not now",
    );
  });

  test("with a trace, the harness span has an mg.subagent child, and the start function's context span is the new root that child recorded", async () => {
    const received: { context?: SubagentContext } = {};
    const researcher: Subagent = {
      name: "researcher",
      input: promptSchema(),
      start: async (_input, context) => {
        received.context = context;
        return "found";
      },
    };
    const provider = stubProvider([
      {
        parts: [
          {
            type: "tool-call",
            id: "c1",
            name: "researcher",
            arguments: { prompt: "find x" },
          },
        ],
        finishReason: "tool_calls",
      },
      { parts: [{ type: "text", text: "ok" }], finishReason: "stop" },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      subagents: [researcher],
      maxTurns: 2,
      stream: false,
    });

    const root = new RecordingSpan("root");
    await collect(harness({ messages: [], trace: root }));

    const harnessSpan = root.children[0];
    expect(harnessSpan?.name).toBe("mg.harness");
    const subagentSpan = harnessSpan?.children.find(
      (child) => child.name === "mg.subagent",
    );
    expect(subagentSpan).toBeDefined();
    const threadSpan = subagentSpan?.newRoots.find(
      (newRoot) => newRoot.name === "mg.thread",
    );
    expect(threadSpan).toBeDefined();
    expect(received.context?.trace).toBe(threadSpan);
  });

  test("without a trace, the start function's context span is undefined", async () => {
    const received: { context?: SubagentContext } = {};
    const researcher: Subagent = {
      name: "researcher",
      input: promptSchema(),
      start: async (_input, context) => {
        received.context = context;
        return "found";
      },
    };
    const provider = stubProvider([
      {
        parts: [
          {
            type: "tool-call",
            id: "c1",
            name: "researcher",
            arguments: { prompt: "find x" },
          },
        ],
        finishReason: "tool_calls",
      },
      { parts: [{ type: "text", text: "ok" }], finishReason: "stop" },
    ]);
    const harness = createLoopHarness({
      provider,
      model: "m",
      subagents: [researcher],
      maxTurns: 2,
      stream: false,
    });

    await collect(harness({ messages: [] }));

    expect(received.context?.trace).toBeUndefined();
  });

  test("with a trace and a gate that denies, the harness span has no mg.subagent child and no fake span records a new root", async () => {
    const start = vi.fn(async () => "found");
    const researcher: Subagent = {
      name: "researcher",
      input: stubSchema(),
      start,
    };
    const provider = stubProvider([
      {
        parts: [
          {
            type: "tool-call",
            id: "c1",
            name: "researcher",
            arguments: {},
          },
        ],
        finishReason: "tool_calls",
      },
    ]);
    const gate = stubGate(async (): Promise<Verdict> => ({
      allowed: false,
      reason: "not now",
    }));
    const harness = createLoopHarness({
      provider,
      model: "m",
      subagents: [researcher],
      maxTurns: 1,
      stream: false,
      gate,
    });

    const root = new RecordingSpan("root");
    await collect(harness({ messages: [], trace: root }));

    expect(start).not.toHaveBeenCalled();
    const harnessSpan = root.children[0];
    expect(
      harnessSpan?.children.some(
        (child) => child.name === "mg.subagent",
      ),
    ).toBe(false);
    expect(
      collectSpans(root).every((span) => span.newRoots.length === 0),
    ).toBe(true);
  });
});
