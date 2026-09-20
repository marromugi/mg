import type {
  GenerateResponse,
  Provider,
  StreamEvent,
  Tool,
  ToolSchema,
} from "@mg/core";
import { defineTool } from "@mg/core";
import type { Gate, Verdict } from "@mg/gate";
import type { Workspace } from "@mg/workspace";
import { defineWorkspace } from "@mg/workspace";
import { describe, expect, test, vi } from "vitest";
import type { SubagentConfig } from "./subagent-config.js";
import { defineSubagent } from "./subagent-config.js";

const stubProvider = (): Provider => {
  const generate = vi.fn(async (): Promise<GenerateResponse> => {
    throw new Error("stubProvider: generate is not scripted");
  });
  const stream = vi.fn((): AsyncIterable<StreamEvent> => {
    throw new Error("stubProvider: stream is not scripted");
  });
  return { generate, stream };
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

const stubGate = (): Gate => ({
  judge: vi.fn(async (): Promise<Verdict> => ({
    allowed: true,
    reason: "ok",
  })),
});

describe("SubagentConfig", () => {
  test("requires a gate when tools are written, and allows neither", () => {
    const base = {
      name: "researcher",
      description: "Researches a topic",
      provider: stubProvider(),
      harness: { kind: "loop", model: "m", maxTurns: 1 },
    } as const;

    // @ts-expect-error a config with tools requires a gate
    defineSubagent({ ...base, tools: [stubTool("a")] });

    const withTools: SubagentConfig = {
      ...base,
      tools: [stubTool("a")],
      gate: stubGate(),
    };
    const withoutMeans: SubagentConfig = { ...base };

    expect(defineSubagent(withTools)).toBe(withTools);
    expect(defineSubagent(withoutMeans)).toBe(withoutMeans);
  });

  test("requires a gate when a workspace receiving mode is written, and allows neither tools nor a workspace", () => {
    const base = {
      name: "researcher",
      description: "Researches a topic",
      provider: stubProvider(),
      harness: { kind: "loop", model: "m", maxTurns: 1 },
    } as const;
    const ownWorkspace: Workspace = defineWorkspace({
      name: "clean-browser",
      connectors: [],
    });

    // @ts-expect-error a config with a workspace receiving mode requires a gate
    defineSubagent({
      ...base,
      workspace: {
        pick: "fixed",
        source: { kind: "own", workspace: ownWorkspace },
      },
    });

    const withWorkspace: SubagentConfig = {
      ...base,
      gate: stubGate(),
      workspace: {
        pick: "fixed",
        source: { kind: "own", workspace: ownWorkspace },
      },
    };
    const withoutMeans: SubagentConfig = { ...base };

    expect(defineSubagent(withWorkspace)).toBe(withWorkspace);
    expect(defineSubagent(withoutMeans)).toBe(withoutMeans);
  });

  test("requires at least one source for the caller-picked workspace receiving mode", () => {
    const base = {
      name: "researcher",
      description: "Researches a topic",
      provider: stubProvider(),
      harness: { kind: "loop", model: "m", maxTurns: 1 },
      gate: stubGate(),
    } as const;

    ({
      ...base,
      workspace: {
        pick: "caller",
        // @ts-expect-error the caller-picked source list must not be empty
        sources: [],
        required: true,
      },
    }) satisfies SubagentConfig;

    const withOneSource: SubagentConfig = {
      ...base,
      workspace: {
        pick: "caller",
        sources: [{ kind: "parent" }],
        required: true,
      },
    };

    expect(defineSubagent(withOneSource)).toBe(withOneSource);
  });

  test("has no item for a list of subagents", () => {
    const base = {
      name: "researcher",
      description: "Researches a topic",
      provider: stubProvider(),
      harness: { kind: "loop", model: "m", maxTurns: 1 },
    } as const;

    ({
      ...base,
      // @ts-expect-error SubagentConfig has no subagents item
      subagents: [],
    }) satisfies SubagentConfig;

    expect(true).toBe(true);
  });
});
