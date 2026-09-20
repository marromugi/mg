import type {
  GenerateRequest,
  GenerateResponse,
  Provider,
  Tool,
  ToolSchema,
} from "@mg/core";
import { defineTool } from "@mg/core";
import type { Gate, Verdict } from "@mg/gate";
import type { Connector, Workspace } from "@mg/workspace";
import { defineWorkspace } from "@mg/workspace";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test, vi } from "vitest";
import type { RunConfig } from "./config.js";
import { run } from "./run.js";

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

const stubTool = (name: string): Tool =>
  defineTool({
    name,
    input: stubSchema(),
    execute: async () => `${name}-result`,
  });

const stubGate = (): Gate => ({
  judge: vi.fn(async (): Promise<Verdict> => ({
    allowed: true,
    reason: "ok",
  })),
});

const textResponse = (text: string): GenerateResponse => ({
  parts: [{ type: "text", text }],
  finishReason: "stop",
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

const fakeConnector = (tools: readonly Tool[]): Connector => ({
  kind: "fake",
  exclusive: [],
  open: async () => ({ tools, close: async () => {} }),
});

const fakeWorkspace = (
  tools: readonly Tool[],
  name = "fake-workspace",
): Workspace =>
  defineWorkspace({ name, connectors: [fakeConnector(tools)] });

describe("run with subagents in the config", () => {
  test("a subagent call from the parent's provider is answered by the child's provider, as a tool message, and the run stops", async () => {
    let parentTurn = 0;
    const parentProvider: Provider = {
      generate: async () => {
        parentTurn++;
        if (parentTurn === 1) {
          return {
            parts: [
              {
                type: "tool-call",
                id: "c1",
                name: "researcher",
                arguments: { prompt: "find x" },
              },
            ],
            finishReason: "tool_calls",
          };
        }
        return textResponse("done");
      },
      stream: () => {
        throw new Error("stream is not scripted");
      },
    };
    const childProvider: Provider = {
      generate: async () => textResponse("found"),
      stream: () => {
        throw new Error("stream is not scripted");
      },
    };
    const config: RunConfig = {
      name: "example",
      provider: parentProvider,
      harness: { kind: "loop", model: "m", maxTurns: 2, stream: false },
      subagents: [
        {
          name: "researcher",
          description: "Researches a topic",
          provider: childProvider,
          harness: {
            kind: "loop",
            model: "m",
            maxTurns: 1,
            stream: false,
          },
        },
      ],
    };

    const outcome = await run(config, []);

    expect(outcome.result.reason).toBe("stop");
    expect(outcome.result.messages).toContainEqual({
      role: "tool",
      toolCallId: "c1",
      content: "found",
    });
  });

  test("records mg.subagent under the run's trace and mg.thread as the root of a separate trace with the same session id and a shared thread id, carrying one mg.harness span", async () => {
    const exporter = new InMemorySpanExporter();
    let parentTurn = 0;
    const parentProvider: Provider = {
      generate: async () => {
        parentTurn++;
        if (parentTurn === 1) {
          return {
            parts: [
              {
                type: "tool-call",
                id: "c1",
                name: "researcher",
                arguments: { prompt: "find x" },
              },
            ],
            finishReason: "tool_calls",
          };
        }
        return textResponse("done");
      },
      stream: () => {
        throw new Error("stream is not scripted");
      },
    };
    const childProvider: Provider = {
      generate: async () => textResponse("found"),
      stream: () => {
        throw new Error("stream is not scripted");
      },
    };
    const config: RunConfig = {
      name: "example",
      provider: parentProvider,
      harness: { kind: "loop", model: "m", maxTurns: 2, stream: false },
      subagents: [
        {
          name: "researcher",
          description: "Researches a topic",
          provider: childProvider,
          harness: {
            kind: "loop",
            model: "m",
            maxTurns: 1,
            stream: false,
          },
        },
      ],
      trace: { exporters: [exporter] },
    };

    await run(config, []);

    const spans = exporter.getFinishedSpans();
    const runSpan = spans.find((span) => span.name === "mg.run");
    const subagentSpan = spans.find(
      (span) => span.name === "mg.subagent",
    );
    const threadSpan = spans.find((span) => span.name === "mg.thread");

    expect(runSpan).toBeDefined();
    expect(subagentSpan).toBeDefined();
    expect(threadSpan).toBeDefined();

    expect(subagentSpan?.spanContext().traceId).toBe(
      runSpan?.spanContext().traceId,
    );
    expect(threadSpan?.spanContext().traceId).not.toBe(
      runSpan?.spanContext().traceId,
    );
    expect(threadSpan?.parentSpanContext).toBeUndefined();

    expect(threadSpan?.resource.attributes["session.id"]).toBe(
      runSpan?.resource.attributes["session.id"],
    );
    expect(threadSpan?.attributes["mg.thread.id"]).toBe(
      subagentSpan?.attributes["mg.thread.id"],
    );

    const harnessSpansInThread = spans.filter(
      (span) =>
        span.name === "mg.harness" &&
        span.spanContext().traceId ===
          threadSpan?.spanContext().traceId,
    );
    expect(harnessSpansInThread).toHaveLength(1);
  });

  test("a subagent with a fixed parent workspace source reaches the child's provider with the run workspace's tools", async () => {
    let parentTurn = 0;
    const parentProvider: Provider = {
      generate: async () => {
        parentTurn++;
        if (parentTurn === 1) {
          return {
            parts: [
              {
                type: "tool-call",
                id: "c1",
                name: "researcher",
                arguments: { prompt: "find x" },
              },
            ],
            finishReason: "tool_calls",
          };
        }
        return textResponse("done");
      },
      stream: () => {
        throw new Error("stream is not scripted");
      },
    };
    const { provider: childProvider, requests } = trackingProvider([
      textResponse("found"),
    ]);
    const config: RunConfig = {
      name: "example",
      provider: parentProvider,
      harness: { kind: "loop", model: "m", maxTurns: 2, stream: false },
      workspace: fakeWorkspace([stubTool("shared")]),
      subagents: [
        {
          name: "researcher",
          description: "Researches a topic",
          provider: childProvider,
          harness: {
            kind: "loop",
            model: "m",
            maxTurns: 1,
            stream: false,
          },
          gate: stubGate(),
          workspace: { pick: "fixed", source: { kind: "parent" } },
        },
      ],
    };

    await run(config, []);

    expect(requests[0]?.tools?.map((tool) => tool.name)).toContain(
      "shared",
    );
  });

  test("a fixed parent workspace source without a run workspace rejects before the parent's provider is called", async () => {
    const generate = vi.fn(async (): Promise<GenerateResponse> => {
      throw new Error("should not be called");
    });
    const parentProvider: Provider = {
      generate,
      stream: () => {
        throw new Error("stream is not scripted");
      },
    };
    const config: RunConfig = {
      name: "example",
      provider: parentProvider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      subagents: [
        {
          name: "helper",
          description: "Helps",
          provider: trackingProvider([]).provider,
          harness: {
            kind: "loop",
            model: "m",
            maxTurns: 1,
            stream: false,
          },
          gate: stubGate(),
          workspace: { pick: "fixed", source: { kind: "parent" } },
        },
      ],
    };

    await expect(run(config, [])).rejects.toThrow(
      'subagent "helper": source "parent" needs a workspace on the run',
    );
    expect(generate).not.toHaveBeenCalled();
  });

  test("a tool and a subagent sharing a name reject before the parent's provider is called, and the run workspace is closed", async () => {
    const generate = vi.fn(async (): Promise<GenerateResponse> => {
      throw new Error("should not be called");
    });
    const parentProvider: Provider = {
      generate,
      stream: () => {
        throw new Error("stream is not scripted");
      },
    };
    let closes = 0;
    const workspace = defineWorkspace({
      name: "fake-workspace",
      connectors: [
        {
          kind: "fake",
          exclusive: [],
          open: async () => ({
            tools: [],
            close: async () => {
              closes++;
            },
          }),
        },
      ],
    });
    const config: RunConfig = {
      name: "example",
      provider: parentProvider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      tools: [stubTool("researcher")],
      workspace,
      subagents: [
        {
          name: "researcher",
          description: "Researches a topic",
          provider: trackingProvider([]).provider,
          harness: {
            kind: "loop",
            model: "m",
            maxTurns: 1,
            stream: false,
          },
        },
      ],
    };

    await expect(run(config, [])).rejects.toThrow(
      'Name "researcher" is used by more than one tool or subagent',
    );
    expect(generate).not.toHaveBeenCalled();
    expect(closes).toBe(1);
  });

  test("a config without subagents exports mg.run, mg.harness and mg.tool spans, with no mg.subagent or mg.thread span", async () => {
    const exporter = new InMemorySpanExporter();
    const echoTool = stubTool("echo");
    let turn = 0;
    const provider: Provider = {
      generate: async () => {
        turn++;
        if (turn === 1) {
          return {
            parts: [
              {
                type: "tool-call",
                id: "call-1",
                name: "echo",
                arguments: {},
              },
            ],
            finishReason: "tool_calls",
          };
        }
        return textResponse("done");
      },
      stream: () => {
        throw new Error("stream is not scripted");
      },
    };
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 2, stream: false },
      tools: [echoTool],
      trace: { exporters: [exporter] },
    };

    await run(config, []);

    const names = exporter.getFinishedSpans().map((span) => span.name);

    expect(names).toContain("mg.run");
    expect(names).toContain("mg.harness");
    expect(names).toContain("mg.tool");
    expect(names).not.toContain("mg.subagent");
    expect(names).not.toContain("mg.thread");
  });
});
