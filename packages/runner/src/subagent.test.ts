import type {
  GenerateRequest,
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
import { runSubagentCall, SubagentInputError } from "@mg/harness";
import type {
  Connector,
  OpenWorkspace,
  Workspace,
} from "@mg/workspace";
import { defineWorkspace } from "@mg/workspace";
import { describe, expect, test, vi } from "vitest";
import { createExclusiveNames } from "./exclusive-names.js";
import { InvalidRunConfigError, SubagentCloseError } from "./errors.js";
import { createSubagent } from "./subagent.js";

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

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

const trackingProvider = (
  responses: readonly GenerateResponse[],
): { provider: Provider; requests: GenerateRequest[] } => {
  let index = 0;
  const requests: GenerateRequest[] = [];
  const provider: Provider = {
    generate: async (request) => {
      requests.push(request);
      const response = responses[index];
      index++;
      if (!response)
        throw new Error("trackingProvider: no scripted response left");
      return response;
    },
    stream: () => {
      throw new Error("trackingProvider: stream is not scripted");
    },
  };
  return { provider, requests };
};

const stubGate = (): Gate => ({
  judge: vi.fn(async (): Promise<Verdict> => ({
    allowed: true,
    reason: "ok",
  })),
});

type ConnectorHooks = {
  onOpen?: () => void;
  onClose?: () => void;
  closeError?: Error;
};

const fakeConnector = (
  tools: readonly Tool[],
  hooks?: ConnectorHooks,
): Connector => ({
  kind: "fake",
  exclusive: [],
  open: async () => {
    hooks?.onOpen?.();
    return {
      tools,
      close: async () => {
        hooks?.onClose?.();
        if (hooks?.closeError) throw hooks.closeError;
      },
    };
  },
});

const fakeWorkspace = (
  tools: readonly Tool[],
  hooks?: ConnectorHooks,
  name = "workspace",
): Workspace =>
  defineWorkspace({ name, connectors: [fakeConnector(tools, hooks)] });

const failingWorkspace = (name: string, error: Error): Workspace =>
  defineWorkspace({
    name,
    connectors: [
      {
        kind: "fake",
        exclusive: [],
        open: async () => {
          throw error;
        },
      },
    ],
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

describe("createSubagent with a workspace", () => {
  test("opens its own workspace per call, merges the config's tools with the workspace's tools, and closes it after finishing", async () => {
    let opens = 0;
    let closes = 0;
    const workspace = fakeWorkspace(
      [stubTool("remote")],
      {
        onOpen: () => {
          opens += 1;
        },
        onClose: () => {
          closes += 1;
        },
      },
      "clean-browser",
    );
    const { provider, requests } = trackingProvider([
      { parts: [{ type: "text", text: "ok" }], finishReason: "stop" },
      { parts: [{ type: "text", text: "ok" }], finishReason: "stop" },
    ]);
    const subagent = createSubagent({
      name: "researcher",
      description: "Researches a topic",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      tools: [stubTool("echo")],
      gate: stubGate(),
      workspace: { pick: "fixed", source: { kind: "own", workspace } },
    });

    const result = await subagent.start({ prompt: "find x" }, {});

    expect(result).toBe("ok");
    expect(requests[0]?.tools?.map((tool) => tool.name)).toEqual([
      "echo",
      "remote",
    ]);
    expect(opens).toBe(1);
    expect(closes).toBe(1);

    await subagent.start({ prompt: "find x" }, {});

    expect(opens).toBe(2);
    expect(closes).toBe(2);
  });

  test("borrows the parent's opened workspace without opening or closing anything, when the source is fixed to the parent", async () => {
    let parentCloses = 0;
    const parent: OpenWorkspace = {
      name: "build-machine",
      tools: [stubTool("shared")],
      close: async () => {
        parentCloses += 1;
      },
    };
    const { provider, requests } = trackingProvider([
      { parts: [{ type: "text", text: "ok" }], finishReason: "stop" },
    ]);
    const subagent = createSubagent(
      {
        name: "researcher",
        description: "Researches a topic",
        provider,
        harness: {
          kind: "loop",
          model: "m",
          maxTurns: 1,
          stream: false,
        },
        gate: stubGate(),
        workspace: { pick: "fixed", source: { kind: "parent" } },
      },
      { parent },
    );

    await subagent.start({ prompt: "find x" }, {});

    expect(requests[0]?.tools?.map((tool) => tool.name)).toContain(
      "shared",
    );
    expect(parentCloses).toBe(0);
  });

  test("builds a required workspace argument enumerating the parent then the subagent's own sources, each described by what it shares", () => {
    const parent: OpenWorkspace = {
      name: "build-machine",
      tools: [],
      close: async () => {},
    };
    const cleanBrowser = fakeWorkspace([], undefined, "clean-browser");
    const subagent = createSubagent(
      {
        name: "researcher",
        description: "Researches a topic",
        provider: scriptedProvider([]).provider,
        harness: {
          kind: "loop",
          model: "m",
          maxTurns: 1,
          stream: false,
        },
        gate: stubGate(),
        workspace: {
          pick: "caller",
          sources: [
            { kind: "parent" },
            { kind: "own", workspace: cleanBrowser },
          ],
          required: true,
        },
      },
      { parent },
    );

    const schema = subagent.input["~standard"].jsonSchema.input({
      target: "draft-07",
    });

    expect(schema).toMatchObject({
      required: ["prompt", "workspace"],
      properties: {
        workspace: {
          enum: ["build-machine", "clean-browser"],
          description:
            'Where the subagent works. "build-machine": the workspace you are using now; the subagent shares its state with you. "clean-browser": a separate workspace, opened for this call and closed when it ends.',
        },
      },
    });
  });

  test("marks the workspace argument optional, appends an omission sentence, and runs with only the config's tools when the argument is omitted", async () => {
    const parent: OpenWorkspace = {
      name: "build-machine",
      tools: [],
      close: async () => {},
    };
    let opens = 0;
    const cleanBrowser = fakeWorkspace(
      [],
      {
        onOpen: () => {
          opens += 1;
        },
      },
      "clean-browser",
    );
    const { provider, requests } = trackingProvider([
      { parts: [{ type: "text", text: "ok" }], finishReason: "stop" },
    ]);
    const subagent = createSubagent(
      {
        name: "researcher",
        description: "Researches a topic",
        provider,
        harness: {
          kind: "loop",
          model: "m",
          maxTurns: 1,
          stream: false,
        },
        tools: [stubTool("echo")],
        gate: stubGate(),
        workspace: {
          pick: "caller",
          sources: [
            { kind: "parent" },
            { kind: "own", workspace: cleanBrowser },
          ],
          required: false,
        },
      },
      { parent },
    );

    const schema = subagent.input["~standard"].jsonSchema.input({
      target: "draft-07",
    }) as {
      required: string[];
      properties: { workspace: { description: string } };
    };

    expect(schema.required).toEqual(["prompt"]);
    expect(
      schema.properties.workspace.description.endsWith(
        " Omit to run without a workspace.",
      ),
    ).toBe(true);

    const result = await subagent.start({ prompt: "x" }, {});

    expect(result).toBe("ok");
    expect(requests[0]?.tools?.map((tool) => tool.name)).toEqual([
      "echo",
    ]);
    expect(opens).toBe(0);
  });

  test("rejects with SubagentInputError and never calls the provider when a required workspace argument is omitted", async () => {
    const parent: OpenWorkspace = {
      name: "build-machine",
      tools: [],
      close: async () => {},
    };
    const cleanBrowser = fakeWorkspace([], undefined, "clean-browser");
    const generate = vi.fn(async (): Promise<GenerateResponse> => {
      throw new Error("should not be called");
    });
    const provider: Provider = {
      generate,
      stream: (): AsyncIterable<StreamEvent> => {
        throw new Error("not scripted");
      },
    };
    const subagent = createSubagent(
      {
        name: "researcher",
        description: "Researches a topic",
        provider,
        harness: {
          kind: "loop",
          model: "m",
          maxTurns: 1,
          stream: false,
        },
        gate: stubGate(),
        workspace: {
          pick: "caller",
          sources: [
            { kind: "parent" },
            { kind: "own", workspace: cleanBrowser },
          ],
          required: true,
        },
      },
      { parent },
    );

    await expect(
      runSubagentCall([subagent], {
        id: "call-1",
        name: "researcher",
        arguments: { prompt: "x" },
      }),
    ).rejects.toThrow(SubagentInputError);
    expect(generate).not.toHaveBeenCalled();
  });

  test("resolves the picked source per call: the own workspace opens and closes when its name is picked, the parent is borrowed when its name is picked", async () => {
    let ownOpens = 0;
    let ownCloses = 0;
    const cleanBrowser = fakeWorkspace(
      [],
      {
        onOpen: () => {
          ownOpens += 1;
        },
        onClose: () => {
          ownCloses += 1;
        },
      },
      "clean-browser",
    );
    const parent: OpenWorkspace = {
      name: "build-machine",
      tools: [stubTool("shared")],
      close: async () => {},
    };
    const { provider, requests } = trackingProvider([
      { parts: [{ type: "text", text: "ok" }], finishReason: "stop" },
      { parts: [{ type: "text", text: "ok" }], finishReason: "stop" },
    ]);
    const subagent = createSubagent(
      {
        name: "researcher",
        description: "Researches a topic",
        provider,
        harness: {
          kind: "loop",
          model: "m",
          maxTurns: 1,
          stream: false,
        },
        gate: stubGate(),
        workspace: {
          pick: "caller",
          sources: [
            { kind: "parent" },
            { kind: "own", workspace: cleanBrowser },
          ],
          required: true,
        },
      },
      { parent },
    );

    await subagent.start(
      { prompt: "x", workspace: "clean-browser" },
      {},
    );

    expect(ownOpens).toBe(1);
    expect(ownCloses).toBe(1);

    await subagent.start(
      { prompt: "x", workspace: "build-machine" },
      {},
    );

    expect(ownOpens).toBe(1);
    expect(requests[1]?.tools?.map((tool) => tool.name)).toContain(
      "shared",
    );
  });

  test("throws ConnectorOpenError and never calls the provider when opening its own workspace fails", async () => {
    const workspace = failingWorkspace(
      "clean-browser",
      new Error("refused"),
    );
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
      tools: [stubTool("echo")],
      gate: stubGate(),
      workspace: { pick: "fixed", source: { kind: "own", workspace } },
    });

    await expect(
      subagent.start({ prompt: "find x" }, {}),
    ).rejects.toMatchObject({ name: "ConnectorOpenError" });
    expect(generate).not.toHaveBeenCalled();
  });

  test("closes its own workspace and throws DuplicateToolNameError, without calling the provider, when the workspace's tools share a name with the config's tools", async () => {
    let closes = 0;
    const workspace = fakeWorkspace(
      [stubTool("echo")],
      {
        onClose: () => {
          closes += 1;
        },
      },
      "clean-browser",
    );
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
      tools: [stubTool("echo")],
      gate: stubGate(),
      workspace: { pick: "fixed", source: { kind: "own", workspace } },
    });

    await expect(
      subagent.start({ prompt: "find x" }, {}),
    ).rejects.toMatchObject({ name: "DuplicateToolNameError" });
    expect(closes).toBe(1);
    expect(generate).not.toHaveBeenCalled();
  });

  test("closes its own workspace and throws the child's failure, even when closing also fails", async () => {
    const error = new Error("provider down");
    let closes = 0;
    const workspace = fakeWorkspace(
      [],
      {
        onClose: () => {
          closes += 1;
        },
      },
      "clean-browser",
    );
    const subagent = createSubagent({
      name: "researcher",
      description: "Researches a topic",
      provider: throwingProvider(error),
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      gate: stubGate(),
      workspace: { pick: "fixed", source: { kind: "own", workspace } },
    });

    await expect(
      subagent.start({ prompt: "find x" }, {}),
    ).rejects.toThrow(error);
    expect(closes).toBe(1);

    const alsoFailingToClose = fakeWorkspace(
      [],
      { closeError: new Error("close failed") },
      "clean-browser",
    );
    const subagent2 = createSubagent({
      name: "researcher",
      description: "Researches a topic",
      provider: throwingProvider(error),
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      gate: stubGate(),
      workspace: {
        pick: "fixed",
        source: { kind: "own", workspace: alsoFailingToClose },
      },
    });

    await expect(
      subagent2.start({ prompt: "find x" }, {}),
    ).rejects.toThrow(error);
  });

  test("throws SubagentCloseError naming the workspace and carrying the child's answer, when the child succeeds but closing its own workspace fails", async () => {
    const closeError = new Error("socket hang up");
    const workspace = fakeWorkspace(
      [],
      { closeError },
      "clean-browser",
    );
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
      gate: stubGate(),
      workspace: { pick: "fixed", source: { kind: "own", workspace } },
    });

    let caught: unknown;
    try {
      await subagent.start({ prompt: "find x" }, {});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SubagentCloseError);
    expect(caught).toMatchObject({
      name: "SubagentCloseError",
      message:
        'The subagent finished, but closing its workspace "clean-browser" failed: Failed to close 1 connection(s). Its answer follows:\nanswer',
    });
  });

  test("throws InvalidRunConfigError at assembly when a fixed parent source is configured without a run workspace", () => {
    let caught: unknown;
    try {
      createSubagent({
        name: "helper",
        description: "Helps",
        provider: scriptedProvider([]).provider,
        harness: {
          kind: "loop",
          model: "m",
          maxTurns: 1,
          stream: false,
        },
        gate: stubGate(),
        workspace: { pick: "fixed", source: { kind: "parent" } },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(InvalidRunConfigError);
    expect(caught).toMatchObject({
      name: "InvalidRunConfigError",
      message:
        'subagent "helper": source "parent" needs a workspace on the run',
    });
  });

  test("throws InvalidRunConfigError at assembly when two caller-picked sources share a name, including a clash with the parent's", () => {
    const parent: OpenWorkspace = {
      name: "build-machine",
      tools: [],
      close: async () => {},
    };
    const duplicateOwn = fakeWorkspace([], undefined, "build-machine");

    let caught: unknown;
    try {
      createSubagent(
        {
          name: "helper",
          description: "Helps",
          provider: scriptedProvider([]).provider,
          harness: {
            kind: "loop",
            model: "m",
            maxTurns: 1,
            stream: false,
          },
          gate: stubGate(),
          workspace: {
            pick: "caller",
            sources: [
              { kind: "parent" },
              { kind: "own", workspace: duplicateOwn },
            ],
            required: true,
          },
        },
        { parent },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(InvalidRunConfigError);
    expect(caught).toMatchObject({
      name: "InvalidRunConfigError",
      message:
        'subagent "helper": workspace name "build-machine" is listed more than once',
    });
  });

  test("nests the own workspace's span and the child harness's span as siblings under the span received in context", async () => {
    const workspace = fakeWorkspace(
      [stubTool("remote")],
      undefined,
      "clean-browser",
    );
    const { provider } = scriptedProvider([
      { parts: [{ type: "text", text: "ok" }], finishReason: "stop" },
    ]);
    const subagent = createSubagent({
      name: "researcher",
      description: "Researches a topic",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      tools: [stubTool("echo")],
      gate: stubGate(),
      workspace: { pick: "fixed", source: { kind: "own", workspace } },
    });
    const t = new RecordingSpan("t");

    await subagent.start({ prompt: "find x" }, { trace: t });

    expect(t.children.map((child) => child.name).sort()).toEqual([
      "mg.harness",
      "mg.workspace",
    ]);
  });
});

describe("createSubagent sharing exclusive names across separate own workspaces", () => {
  const deferredProvider = (): {
    provider: Provider;
    resolve: (text: string) => void;
  } => {
    let resolveGenerate: (
      response: GenerateResponse,
    ) => void = () => {};
    const provider: Provider = {
      generate: () =>
        new Promise((resolve) => {
          resolveGenerate = resolve;
        }),
      stream: (): AsyncIterable<StreamEvent> => {
        throw new Error("deferredProvider: stream is not scripted");
      },
    };
    return {
      provider,
      resolve: (text) =>
        resolveGenerate({
          parts: [{ type: "text", text }],
          finishReason: "stop",
        }),
    };
  };

  const recordingWorkspace = (
    log: string[],
    exclusive: readonly string[],
    name: string,
    hooks?: { closeError?: Error },
  ): Workspace =>
    defineWorkspace({
      name,
      connectors: [
        {
          kind: "fake",
          exclusive,
          open: async () => {
            log.push("open");
            return {
              tools: [],
              close: async () => {
                log.push("close");
                if (hooks?.closeError) throw hooks.closeError;
              },
            };
          },
        },
      ],
    });

  test("opens the second own workspace only after the first, holding the same name, has closed", async () => {
    const log: string[] = [];
    const workspaceA = recordingWorkspace(
      log,
      ["cdp:localhost:9222"],
      "browser-a",
    );
    const workspaceB = recordingWorkspace(
      log,
      ["cdp:localhost:9222"],
      "browser-b",
    );
    const exclusive = createExclusiveNames();
    const first = deferredProvider();
    const second = deferredProvider();
    const subagentA = createSubagent(
      {
        name: "a",
        description: "d",
        provider: first.provider,
        harness: {
          kind: "loop",
          model: "m",
          maxTurns: 1,
          stream: false,
        },
        gate: stubGate(),
        workspace: {
          pick: "fixed",
          source: { kind: "own", workspace: workspaceA },
        },
      },
      { exclusive },
    );
    const subagentB = createSubagent(
      {
        name: "b",
        description: "d",
        provider: second.provider,
        harness: {
          kind: "loop",
          model: "m",
          maxTurns: 1,
          stream: false,
        },
        gate: stubGate(),
        workspace: {
          pick: "fixed",
          source: { kind: "own", workspace: workspaceB },
        },
      },
      { exclusive },
    );

    const runA = subagentA.start({ prompt: "x" }, {});
    const runB = subagentB.start({ prompt: "x" }, {});
    await flushMicrotasks();

    first.resolve("a-done");
    await runA;
    await flushMicrotasks();
    second.resolve("b-done");
    await runB;

    expect(log).toEqual(["open", "close", "open", "close"]);
  });

  test("opens both own workspaces without waiting, when they hold different names", async () => {
    const log: string[] = [];
    const workspaceA = recordingWorkspace(
      log,
      ["cdp:a:1"],
      "browser-a",
    );
    const workspaceB = recordingWorkspace(
      log,
      ["cdp:b:1"],
      "browser-b",
    );
    const exclusive = createExclusiveNames();
    const first = deferredProvider();
    const second = deferredProvider();
    const subagentA = createSubagent(
      {
        name: "a",
        description: "d",
        provider: first.provider,
        harness: {
          kind: "loop",
          model: "m",
          maxTurns: 1,
          stream: false,
        },
        gate: stubGate(),
        workspace: {
          pick: "fixed",
          source: { kind: "own", workspace: workspaceA },
        },
      },
      { exclusive },
    );
    const subagentB = createSubagent(
      {
        name: "b",
        description: "d",
        provider: second.provider,
        harness: {
          kind: "loop",
          model: "m",
          maxTurns: 1,
          stream: false,
        },
        gate: stubGate(),
        workspace: {
          pick: "fixed",
          source: { kind: "own", workspace: workspaceB },
        },
      },
      { exclusive },
    );

    const runA = subagentA.start({ prompt: "x" }, {});
    const runB = subagentB.start({ prompt: "x" }, {});
    await flushMicrotasks();

    expect(log).toEqual(["open", "open"]);

    first.resolve("a-done");
    await runA;
    second.resolve("b-done");
    await runB;
  });

  test("still opens the second own workspace, releasing the shared name, when the first fails to close", async () => {
    const log: string[] = [];
    const workspaceA = recordingWorkspace(
      log,
      ["cdp:localhost:9222"],
      "browser-a",
      { closeError: new Error("socket hang up") },
    );
    const workspaceB = recordingWorkspace(
      log,
      ["cdp:localhost:9222"],
      "browser-b",
    );
    const exclusive = createExclusiveNames();
    const first = deferredProvider();
    const second = deferredProvider();
    const subagentA = createSubagent(
      {
        name: "a",
        description: "d",
        provider: first.provider,
        harness: {
          kind: "loop",
          model: "m",
          maxTurns: 1,
          stream: false,
        },
        gate: stubGate(),
        workspace: {
          pick: "fixed",
          source: { kind: "own", workspace: workspaceA },
        },
      },
      { exclusive },
    );
    const subagentB = createSubagent(
      {
        name: "b",
        description: "d",
        provider: second.provider,
        harness: {
          kind: "loop",
          model: "m",
          maxTurns: 1,
          stream: false,
        },
        gate: stubGate(),
        workspace: {
          pick: "fixed",
          source: { kind: "own", workspace: workspaceB },
        },
      },
      { exclusive },
    );

    const runA = subagentA.start({ prompt: "x" }, {});
    const runB = subagentB.start({ prompt: "x" }, {});
    await flushMicrotasks();

    first.resolve("a-done");
    await expect(runA).rejects.toThrow();
    await flushMicrotasks();
    second.resolve("b-done");
    await expect(runB).resolves.toBe("b-done");
  });

  test("throws InvalidRunConfigError at assembly when its own workspace's held name overlaps a name the run's workspace holds for the whole run", () => {
    const cleanBrowser = recordingWorkspace(
      [],
      ["cdp:localhost:9222"],
      "clean-browser",
    );
    const parent: OpenWorkspace = {
      name: "build-machine",
      tools: [],
      close: async () => {},
    };

    let caught: unknown;
    try {
      createSubagent(
        {
          name: "helper",
          description: "Helps",
          provider: scriptedProvider([]).provider,
          harness: {
            kind: "loop",
            model: "m",
            maxTurns: 1,
            stream: false,
          },
          gate: stubGate(),
          workspace: {
            pick: "fixed",
            source: { kind: "own", workspace: cleanBrowser },
          },
        },
        {
          parent,
          parentExclusiveNames: ["cdp:localhost:9222"],
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(InvalidRunConfigError);
    expect(caught).toMatchObject({
      name: "InvalidRunConfigError",
      message:
        'subagent "helper": workspace "clean-browser" holds "cdp:localhost:9222", which the run\'s workspace holds for the whole run',
    });
  });
});
