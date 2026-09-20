import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  GenerateRequest,
  GenerateResponse,
  Provider,
  StreamEvent,
  Tool,
  ToolSchema,
} from "@mg/core";
import { defineTool } from "@mg/core";
import type { HarnessEvent } from "@mg/harness";
import type { Connector, Workspace } from "@mg/workspace";
import { defineWorkspace, DuplicateToolNameError } from "@mg/workspace";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { RunConfig } from "./config.js";
import { run } from "./run.js";

const stubProvider = (
  responses: readonly GenerateResponse[],
): Provider => {
  let index = 0;
  return {
    generate: async () => {
      const response = responses[index];
      index++;
      if (!response)
        throw new Error("stubProvider: no scripted response left");
      return response;
    },
    stream: () => {
      throw new Error("stubProvider: stream is not scripted");
    },
  };
};

const stubStreamProvider = (
  turns: readonly StreamEvent[][],
): Provider => {
  let index = 0;
  return {
    generate: async () => {
      throw new Error("stubStreamProvider: generate is not scripted");
    },
    stream: () => {
      const events = turns[index];
      index++;
      if (!events)
        throw new Error("stubStreamProvider: no scripted turn left");
      return (async function* () {
        for (const event of events) {
          yield event;
        }
      })();
    },
  };
};

const throwingProvider = (error: Error): Provider => ({
  generate: async () => {
    throw error;
  },
  stream: () => {
    throw new Error("throwingProvider: stream is not scripted");
  },
});

const nullRejectingProvider = (): Provider => ({
  generate: () => Promise.reject(null),
  stream: () => {
    throw new Error("nullRejectingProvider: stream is not scripted");
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

type FakeConnectorHooks = {
  onOpen?: () => void;
  onClose?: () => void;
  closeError?: Error;
  closeDelayMs?: number;
};

const fakeConnector = (
  tools: readonly Tool[],
  hooks?: FakeConnectorHooks,
): Connector => ({
  kind: "fake",
  open: async () => {
    hooks?.onOpen?.();
    return {
      tools,
      close: async () => {
        if (hooks?.closeDelayMs) {
          await new Promise((resolve) =>
            setTimeout(resolve, hooks.closeDelayMs),
          );
        }
        hooks?.onClose?.();
        if (hooks?.closeError) throw hooks.closeError;
      },
    };
  },
});

const fakeWorkspace = (
  tools: readonly Tool[],
  hooks?: FakeConnectorHooks,
  name = "fake-workspace",
): Workspace =>
  defineWorkspace({
    name,
    connectors: [fakeConnector(tools, hooks)],
  });

const spanEndMillis = (
  span: { endTime: [number, number] } | undefined,
): number => {
  if (!span) {
    throw new Error("spanEndMillis: span not found");
  }
  return span.endTime[0] * 1000 + span.endTime[1] / 1e6;
};

describe("run", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mg-run-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns the last result and a non-empty session id", async () => {
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
    };

    const outcome = await run(config, []);

    expect(outcome.result.reason).toBe("stop");
    expect(outcome.sessionId.length).toBeGreaterThan(0);
  });

  test("exports an mg.run root span carrying the run name, with mg.harness as its child", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      trace: { exporters: [exporter] },
    };

    await run(config, []);

    const spans = exporter.getFinishedSpans();
    const rootSpan = spans.find((span) => span.name === "mg.run");
    const harnessSpan = spans.find(
      (span) => span.name === "mg.harness",
    );

    expect(rootSpan).toBeDefined();
    expect(harnessSpan).toBeDefined();
    expect(rootSpan?.attributes["mg.run.name"]).toBe("example");
    expect(harnessSpan?.parentSpanContext?.spanId).toBe(
      rootSpan?.spanContext().spanId,
    );
    expect(harnessSpan?.spanContext().traceId).toBe(
      rootSpan?.spanContext().traceId,
    );
  });

  test("onEvent sees text-delta, turn, done in order", async () => {
    const provider = stubStreamProvider([
      [
        { type: "text-delta", delta: "hi" },
        { type: "finish", finishReason: "stop" },
      ],
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: true },
    };

    const seen: HarnessEvent["type"][] = [];
    await run(config, [], {
      onEvent: (event) => seen.push(event.type),
    });

    expect(seen).toEqual(["text-delta", "turn", "done"]);
  });

  test("a provider that throws rejects run, ends the root span with an error, and still exports it", async () => {
    const exporter = new InMemorySpanExporter();
    const error = new Error("provider blew up");
    const provider = throwingProvider(error);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      trace: { exporters: [exporter] },
    };

    await expect(run(config, [])).rejects.toThrow(error);

    const rootSpan = exporter
      .getFinishedSpans()
      .find((span) => span.name === "mg.run");
    expect(rootSpan).toBeDefined();
    expect(rootSpan?.status.code).toBe(2);
  });

  test("a provider that rejects with null makes run reject with null, and the mg.run span ends as an error", async () => {
    const exporter = new InMemorySpanExporter();
    const config: RunConfig = {
      name: "example",
      provider: nullRejectingProvider(),
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      trace: { exporters: [exporter] },
    };

    await expect(run(config, [])).rejects.toBeNull();

    const rootSpan = exporter
      .getFinishedSpans()
      .find((span) => span.name === "mg.run");
    expect(rootSpan?.status.code).toBe(2);
  });

  test("the sessionId option is honoured on every exported span", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      trace: { exporters: [exporter] },
    };

    const outcome = await run(config, [], { sessionId: "s1" });

    expect(outcome.sessionId).toBe("s1");
    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(span.resource.attributes["session.id"]).toBe("s1");
    }
  });

  test("running twice with the same exporter delivers both mg.run spans under different session ids", async () => {
    const exporter = new InMemorySpanExporter();
    const config: RunConfig = {
      name: "example",
      provider: stubProvider([
        { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
      ]),
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      trace: { exporters: [exporter] },
    };

    const first = await run(config, []);
    const second = await run(
      {
        ...config,
        provider: stubProvider([
          {
            parts: [{ type: "text", text: "hi" }],
            finishReason: "stop",
          },
        ]),
      },
      [],
    );

    expect(first.sessionId).not.toBe(second.sessionId);

    const rootSpans = exporter
      .getFinishedSpans()
      .filter((span) => span.name === "mg.run");
    expect(rootSpans).toHaveLength(2);
    const sessionIds = rootSpans.map(
      (span) => span.resource.attributes["session.id"],
    );
    expect(sessionIds).toEqual([first.sessionId, second.sessionId]);
  });

  test("an unopenable trace destination rejects run before onEvent runs", async () => {
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "");
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      trace: { sqlitePath: join(blocker, "db.sqlite") },
    };
    const onEvent = vi.fn();

    await expect(run(config, [], { onEvent })).rejects.toThrow();

    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe("run with a workspace", () => {
  test("the workspace's tools reach the harness alongside the config's tools", async () => {
    const configTool = stubTool("config-tool");
    const workspaceTool = stubTool("workspace-tool");
    const { provider, requests } = trackingProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      tools: [configTool],
      workspace: fakeWorkspace([workspaceTool]),
    };

    await run(config, []);

    expect(requests[0]?.tools).toEqual([configTool, workspaceTool]);
  });

  test("a tool name shared by the config and the workspace closes the workspace and throws DuplicateToolNameError", async () => {
    const name = "shared-name";
    const configTool = stubTool(name);
    const workspaceTool = stubTool(name);
    let closed = false;
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      tools: [configTool],
      workspace: fakeWorkspace([workspaceTool], {
        onClose: () => {
          closed = true;
        },
      }),
    };

    await expect(run(config, [])).rejects.toThrow(
      DuplicateToolNameError,
    );

    expect(closed).toBe(true);
  });

  test("a shared tool name still throws DuplicateToolNameError even when closing the workspace itself fails", async () => {
    const name = "shared-name";
    const configTool = stubTool(name);
    const workspaceTool = stubTool(name);
    let closeAttempted = false;
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      tools: [configTool],
      workspace: fakeWorkspace([workspaceTool], {
        onClose: () => {
          closeAttempted = true;
        },
        closeError: new Error("close failed"),
      }),
    };

    await expect(run(config, [])).rejects.toThrow(
      DuplicateToolNameError,
    );

    expect(closeAttempted).toBe(true);
  });

  test("a shared tool name ends the mg.run span with the duplicate-name failure only after the workspace finishes closing", async () => {
    const exporter = new InMemorySpanExporter();
    const name = "dup";
    const configTool = stubTool(name);
    const workspaceTool = stubTool(name);
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      tools: [configTool],
      workspace: fakeWorkspace(
        [workspaceTool],
        { closeDelayMs: 50 },
        "ws",
      ),
      trace: { exporters: [exporter] },
    };
    const expectedMessage =
      'Duplicate tool name "dup" from connectors: config, ws';

    await expect(run(config, [])).rejects.toThrow(expectedMessage);

    const spans = exporter.getFinishedSpans();
    const rootSpan = spans.find((span) => span.name === "mg.run");
    const workspaceSpan = spans.find(
      (span) => span.name === "mg.workspace",
    );

    expect(rootSpan?.status.code).toBe(2);
    expect(rootSpan?.status.message).toBe(expectedMessage);
    expect(spanEndMillis(rootSpan)).toBeGreaterThanOrEqual(
      spanEndMillis(workspaceSpan),
    );
  });

  test("the workspace is closed after a successful run", async () => {
    let closed = false;
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      workspace: fakeWorkspace([], {
        onClose: () => {
          closed = true;
        },
      }),
    };

    await run(config, []);

    expect(closed).toBe(true);
  });

  test("the workspace is closed when the run fails, and the run's error is thrown", async () => {
    let closed = false;
    const error = new Error("provider blew up");
    const provider = throwingProvider(error);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      workspace: fakeWorkspace([], {
        onClose: () => {
          closed = true;
        },
      }),
    };

    await expect(run(config, [])).rejects.toThrow(error);

    expect(closed).toBe(true);
  });

  test("the mg.run span ends no earlier than the mg.workspace span it waits to close", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      workspace: fakeWorkspace([], { closeDelayMs: 50 }),
      trace: { exporters: [exporter] },
    };

    await run(config, []);

    const spans = exporter.getFinishedSpans();
    const rootSpan = spans.find((span) => span.name === "mg.run");
    const workspaceSpan = spans.find(
      (span) => span.name === "mg.workspace",
    );

    expect(spanEndMillis(rootSpan)).toBeGreaterThanOrEqual(
      spanEndMillis(workspaceSpan),
    );
  });

  test("a close failure alone (the run itself succeeded) is thrown, and both spans end with the close failure", async () => {
    const exporter = new InMemorySpanExporter();
    const closeError = new Error("close boom");
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      workspace: fakeWorkspace([], { closeError }),
      trace: { exporters: [exporter] },
    };
    const expectedMessage = "Failed to close 1 connection(s)";

    await expect(run(config, [])).rejects.toMatchObject({
      name: "WorkspaceCloseError",
      message: expectedMessage,
      cause: closeError,
      errors: [closeError],
    });

    const spans = exporter.getFinishedSpans();
    const rootSpan = spans.find((span) => span.name === "mg.run");
    const workspaceSpan = spans.find(
      (span) => span.name === "mg.workspace",
    );

    expect(rootSpan?.status.code).toBe(2);
    expect(rootSpan?.status.message).toBe(expectedMessage);
    expect(workspaceSpan?.status.code).toBe(2);
    expect(workspaceSpan?.status.message).toBe(expectedMessage);
  });

  test("a harness failure and a close failure together reject with the harness failure, and only the mg.workspace span carries the close failure", async () => {
    const exporter = new InMemorySpanExporter();
    const providerError = new Error("provider boom");
    const closeError = new Error("close boom");
    const provider = throwingProvider(providerError);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      workspace: fakeWorkspace([], { closeError }),
      trace: { exporters: [exporter] },
    };

    await expect(run(config, [])).rejects.toThrow("provider boom");

    const spans = exporter.getFinishedSpans();
    const rootSpan = spans.find((span) => span.name === "mg.run");
    const workspaceSpan = spans.find(
      (span) => span.name === "mg.workspace",
    );

    expect(rootSpan?.status.code).toBe(2);
    expect(rootSpan?.status.message).toBe("provider boom");
    expect(workspaceSpan?.status.code).toBe(2);
    expect(workspaceSpan?.status.message).toBe(
      "Failed to close 1 connection(s)",
    );
    expect(spanEndMillis(rootSpan)).toBeGreaterThanOrEqual(
      spanEndMillis(workspaceSpan),
    );
  });

  test("records exactly one mg.workspace span under mg.run, as a sibling of mg.harness", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      workspace: fakeWorkspace([]),
      trace: { exporters: [exporter] },
    };

    await run(config, []);

    const spans = exporter.getFinishedSpans();
    const rootSpan = spans.find((span) => span.name === "mg.run");
    const harnessSpan = spans.find(
      (span) => span.name === "mg.harness",
    );
    const workspaceSpans = spans.filter(
      (span) => span.name === "mg.workspace",
    );

    expect(workspaceSpans).toHaveLength(1);
    expect(workspaceSpans[0]?.parentSpanContext?.spanId).toBe(
      rootSpan?.spanContext().spanId,
    );
    expect(harnessSpan?.parentSpanContext?.spanId).toBe(
      rootSpan?.spanContext().spanId,
    );
  });

  test("the mg.workspace span carries the workspace's name, its connectors' kinds, and the opened tools' names", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const connectorA: Connector = {
      kind: "alpha",
      open: async () => ({
        tools: [stubTool("tool-a")],
        close: async () => {},
      }),
    };
    const connectorB: Connector = {
      kind: "beta",
      open: async () => ({
        tools: [stubTool("tool-b")],
        close: async () => {},
      }),
    };
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      workspace: defineWorkspace({
        name: "ws",
        connectors: [connectorA, connectorB],
      }),
      trace: { exporters: [exporter] },
    };

    await run(config, []);

    const workspaceSpan = exporter
      .getFinishedSpans()
      .find((span) => span.name === "mg.workspace");

    expect(workspaceSpan?.attributes["mg.workspace.name"]).toBe("ws");
    expect(workspaceSpan?.attributes["mg.workspace.connectors"]).toBe(
      JSON.stringify(["alpha", "beta"]),
    );
    expect(workspaceSpan?.attributes["mg.workspace.tools"]).toBe(
      JSON.stringify(["tool-a", "tool-b"]),
    );
  });

  test("a workspace that fails to open ends both the mg.workspace and mg.run spans with the connector's failure, and no mg.harness span is recorded", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      workspace: defineWorkspace({
        name: "broken-workspace",
        connectors: [
          {
            kind: "fake",
            open: async () => {
              throw new Error("open boom");
            },
          },
        ],
      }),
      trace: { exporters: [exporter] },
    };
    const expectedMessage =
      'Failed to open connector "fake" at index 0';

    await expect(run(config, [])).rejects.toThrow(expectedMessage);

    const spans = exporter.getFinishedSpans();
    const rootSpan = spans.find((span) => span.name === "mg.run");
    const workspaceSpan = spans.find(
      (span) => span.name === "mg.workspace",
    );
    const harnessSpan = spans.find(
      (span) => span.name === "mg.harness",
    );

    expect(rootSpan?.status.code).toBe(2);
    expect(rootSpan?.status.message).toBe(expectedMessage);
    expect(workspaceSpan?.status.code).toBe(2);
    expect(workspaceSpan?.status.message).toBe(expectedMessage);
    expect(harnessSpan).toBeUndefined();
  });

  test("omitting workspace leaves the harness with only the config's tools", async () => {
    const configTool = stubTool("config-tool");
    const { provider, requests } = trackingProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      tools: [configTool],
    };

    const outcome = await run(config, []);

    expect(outcome.result.reason).toBe("stop");
    expect(requests[0]?.tools).toEqual([configTool]);
  });
});
