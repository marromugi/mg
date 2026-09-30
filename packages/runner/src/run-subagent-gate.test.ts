import type {
  GenerateResponse,
  Provider,
  Tool,
  ToolSchema,
} from "@mg/core";
import { defineTool } from "@mg/core";
import type { Gate, Verdict } from "@mg/gate";
import { defineWorkspace } from "@mg/workspace";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test, vi } from "vitest";
import type { RunConfig } from "./config.js";
import { GateRequiredError } from "./errors.js";
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
    reach: async () => ({ kind: "any-local" }),
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

const harness = {
  kind: "loop" as const,
  model: "m",
  maxTurns: 1,
  stream: false,
};

const answeringProvider = (): Provider => ({
  toolForcing: true,
  generate: async (): Promise<GenerateResponse> => ({
    parts: [{ type: "text", text: "hi" }],
    finishReason: "stop",
  }),
  stream: () => {
    throw new Error("stream is not scripted");
  },
});

const untypedSetup = (subagentMeans: Record<string, unknown>) => {
  const generate = vi.fn(async (): Promise<GenerateResponse> => {
    throw new Error("should not be called");
  });
  const provider: Provider = {
    toolForcing: true,
    generate,
    stream: () => {
      throw new Error("stream is not scripted");
    },
  };
  let opens = 0;
  const exporter = new InMemorySpanExporter();
  const config = {
    name: "example",
    provider,
    harness,
    gate: stubGate(),
    workspace: defineWorkspace({
      name: "parent",
      connectors: [
        {
          kind: "fake",
          exclusive: [],
          open: async () => {
            opens += 1;
            return { tools: [], close: async () => {} };
          },
        },
      ],
    }),
    subagents: [
      {
        name: "helper",
        description: "Helps",
        provider,
        harness,
        ...subagentMeans,
      },
    ],
    trace: { exporters: [exporter] },
  } as unknown as RunConfig;
  return { config, generate, opens: () => opens, exporter };
};

const subagentMessage =
  'subagent "helper": gate is required when tools or workspace is set';

describe("run with a subagent config that has means and no gate", () => {
  test("rejects naming the subagent, before the provider, the workspace or any span, when its tools is one tool", async () => {
    const { config, generate, opens, exporter } = untypedSetup({
      tools: [stubTool("t")],
    });

    const error = await run(config, []).catch((caught) => caught);

    expect(error).toBeInstanceOf(GateRequiredError);
    expect((error as GateRequiredError).message).toBe(subagentMessage);
    expect(generate).not.toHaveBeenCalled();
    expect(opens()).toBe(0);
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  test("rejects the same way when its tools is an empty list", async () => {
    const { config, generate } = untypedSetup({ tools: [] });

    const error = await run(config, []).catch((caught) => caught);

    expect(error).toBeInstanceOf(GateRequiredError);
    expect((error as GateRequiredError).message).toBe(subagentMessage);
    expect(generate).not.toHaveBeenCalled();
  });

  test("rejects the same way when it holds a fixed own workspace", async () => {
    const { config, opens, exporter } = untypedSetup({
      workspace: {
        pick: "fixed",
        source: {
          kind: "own",
          workspace: defineWorkspace({ name: "own", connectors: [] }),
        },
      },
    });

    const error = await run(config, []).catch((caught) => caught);

    expect(error).toBeInstanceOf(GateRequiredError);
    expect((error as GateRequiredError).message).toBe(subagentMessage);
    expect(opens()).toBe(0);
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  test("names the run config's missing gate first, without a subagent prefix", async () => {
    const { config } = untypedSetup({ tools: [stubTool("t")] });
    const ungated = {
      ...config,
      gate: undefined,
      workspace: undefined,
      tools: [stubTool("a")],
    } as unknown as RunConfig;

    const error = await run(ungated, []).catch((caught) => caught);

    expect((error as GateRequiredError).message).toBe(
      "gate is required when tools or workspace is set",
    );
  });

  test("names the tools added to the call before the subagent", async () => {
    const { config } = untypedSetup({ tools: [stubTool("t")] });
    const ungated = {
      ...config,
      gate: undefined,
      workspace: undefined,
    } as unknown as RunConfig;

    const error = await run(ungated, [], {
      tools: [stubTool("x")],
    } as never).catch((caught) => caught);

    expect((error as GateRequiredError).message).toBe(
      "gate is required when tools are added to the call",
    );
  });

  test("names the first failing subagent in list order", async () => {
    const { config } = untypedSetup({ tools: [stubTool("t")] });
    const [helper] = config.subagents ?? [];
    const two = {
      ...config,
      subagents: [
        { ...helper, name: "first" },
        { ...helper, name: "second" },
      ],
    } as unknown as RunConfig;

    const error = await run(two, []).catch((caught) => caught);

    expect((error as GateRequiredError).message).toBe(
      'subagent "first": gate is required when tools or workspace is set',
    );
  });

  test("runs a subagent that has a gate with tools", async () => {
    const provider = answeringProvider();
    const config: RunConfig = {
      name: "example",
      provider,
      harness,
      gate: stubGate(),
      subagents: [
        {
          name: "helper",
          description: "Helps",
          provider,
          harness,
          gate: stubGate(),
          tools: [stubTool("t")],
        },
      ],
    };

    const outcome = await run(config, []);

    expect(outcome.result.reason).toBe("stop");
  });

  test("runs a subagent that has no gate, tools or workspace", async () => {
    const provider = answeringProvider();
    const config: RunConfig = {
      name: "example",
      provider,
      harness,
      subagents: [
        { name: "helper", description: "Helps", provider, harness },
      ],
    };

    const outcome = await run(config, []);

    expect(outcome.result.reason).toBe("stop");
  });
});
