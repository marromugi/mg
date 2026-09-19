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
        hooks?.onClose?.();
        if (hooks?.closeError) throw hooks.closeError;
      },
    };
  },
});

const fakeWorkspace = (
  tools: readonly Tool[],
  hooks?: FakeConnectorHooks,
): Workspace =>
  defineWorkspace({
    name: "fake-workspace",
    connectors: [fakeConnector(tools, hooks)],
  });

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

  test("a close failure alone (the run itself succeeded) is thrown", async () => {
    const closeError = new Error("close failed");
    const provider = stubProvider([
      { parts: [{ type: "text", text: "hi" }], finishReason: "stop" },
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      workspace: fakeWorkspace([], { closeError }),
    };

    await expect(run(config, [])).rejects.toMatchObject({
      name: "WorkspaceCloseError",
      errors: [closeError],
    });
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
