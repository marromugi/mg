import {
  defineTool,
  type AbsolutePath,
  ToolInputError,
  ToolNotFoundError,
  type Reach,
  type Tool,
  type ToolCall,
  type ToolSchema,
} from "@mg/core";
import { toAbsolutePath } from "@mg/local-path";
import type { TraceAttributes, TraceSpan } from "@mg/harness";
import { SPAN, ATTR, tracePrepareToolCall } from "@mg/trace";
import { describe, expect, it, vi } from "vitest";
import { GateError } from "./errors.js";
import { createRulesGate } from "./rules/index.js";
import type {
  Gate,
  GateContext,
  GateRequest,
  Verdict,
} from "./types.js";
import {
  gateRunToolCall,
  toToolCallRequest,
  type ToolCallPayload,
} from "./tool-gate.js";

type Validate = ToolSchema["~standard"]["validate"];

const schema: ToolSchema = {
  "~standard": {
    version: 1,
    vendor: "mg-test",
    validate: ((value) => ({ value })) satisfies Validate,
    jsonSchema: {
      input: () => ({ type: "object" }),
      output: () => ({ type: "object" }),
    },
  },
};

const numberSchema: ToolSchema = {
  "~standard": {
    version: 1,
    vendor: "mg-test",
    validate: ((value) => {
      const a = (value as { a?: unknown }).a;
      return typeof a === "number"
        ? { value }
        : { issues: [{ message: "Expected number" }] };
    }) satisfies Validate,
    jsonSchema: {
      input: () => ({ type: "object" }),
      output: () => ({ type: "object" }),
    },
  },
};

const recordingGate = (
  seen: GateRequest[],
  verdict: Verdict = { allowed: true, reason: "ok" },
): Gate => ({
  judge: async (request): Promise<Verdict> => {
    seen.push(request);
    return verdict;
  },
});

const fileReach: Reach = {
  kind: "paths",
  paths: [{ path: toAbsolutePath("/x/a.txt"), extent: "file" }],
};

const fakeTool = (
  overrides: Partial<Tool> & {
    prepare?: Tool["prepare"];
  } = {},
): Tool =>
  defineTool({
    name: "t",
    description: "d",
    input: schema,
    async prepare() {
      return { reach: fileReach, run: async () => "ran-1" };
    },
    ...overrides,
  });

const call: ToolCall = { id: "c1", name: "t", arguments: { a: 1 } };

describe("toToolCallRequest", () => {
  it("describes a tool without a description as (none)", () => {
    const tool = fakeTool({ description: undefined });

    const request = toToolCallRequest([tool], call, fileReach);

    expect(request.description).toContain("Description: (none)");
  });

  it("describes an unknown tool as (unknown tool) with payload.tool undefined", () => {
    const request = toToolCallRequest([], call, { kind: "any-local" });

    expect(request.description).toContain(
      "Description: (unknown tool)",
    );
    const payload = request.payload as ToolCallPayload;
    expect(payload.tool).toBeUndefined();
  });
});

describe("gateRunToolCall", () => {
  it("judges the reach of the prepared call and returns that same call's result, preparing once", async () => {
    const seen: GateRequest[] = [];
    let prepared = 0;
    const tool = fakeTool({
      async prepare() {
        prepared += 1;
        return { reach: fileReach, run: async () => "ran-1" };
      },
    });

    const message = await gateRunToolCall(recordingGate(seen))(
      [tool],
      call,
    );

    expect(seen).toHaveLength(1);
    expect((seen[0].payload as ToolCallPayload).reach).toEqual({
      kind: "paths",
      paths: [{ path: toAbsolutePath("/x/a.txt"), extent: "file" }],
    });
    expect(message).toEqual({
      role: "tool",
      toolCallId: "c1",
      content: "ran-1",
    });
    expect(prepared).toBe(1);
  });

  it("sends the gate a tool-call request whose tool has no prepare", async () => {
    const seen: GateRequest[] = [];

    await gateRunToolCall(recordingGate(seen))([fakeTool()], call);

    expect(seen[0].kind).toBe("tool-call");
    const payload = seen[0].payload as ToolCallPayload;
    expect(payload.tool).toEqual({
      name: "t",
      description: "d",
      input: schema,
    });
    expect(payload.tool).not.toHaveProperty("prepare");
    expect(seen[0].description).toBe(
      'Tool: t\nDescription: d\nArguments:\n{\n  "a": 1\n}',
    );
  });

  it("judges any-local without a tool definition and rejects with ToolNotFoundError when the name is not found", async () => {
    const seen: GateRequest[] = [];

    const outcome = gateRunToolCall(recordingGate(seen))([fakeTool()], {
      id: "c1",
      name: "nope",
      arguments: {},
    });

    await expect(outcome).rejects.toBeInstanceOf(ToolNotFoundError);
    await expect(outcome).rejects.toThrow(
      "No tool named nope for tool call c1",
    );
    const payload = seen[0].payload as ToolCallPayload;
    expect(payload.reach).toEqual({ kind: "any-local" });
    expect(payload.tool).toBeUndefined();
    expect(seen[0].description.split("\n")[1]).toBe(
      "Description: (unknown tool)",
    );
  });

  it("judges any-local, rejects with ToolInputError and prepares nothing when the input is invalid", async () => {
    const seen: GateRequest[] = [];
    let prepared = 0;
    const tool = fakeTool({
      input: numberSchema,
      async prepare() {
        prepared += 1;
        return { reach: fileReach, run: async () => "ran-1" };
      },
    });

    const outcome = gateRunToolCall(recordingGate(seen))([tool], {
      id: "c1",
      name: "t",
      arguments: { a: "x" },
    });

    await expect(outcome).rejects.toBeInstanceOf(ToolInputError);
    await expect(outcome).rejects.toThrow(
      "Invalid arguments for tool call c1 (t)",
    );
    expect((seen[0].payload as ToolCallPayload).reach).toEqual({
      kind: "any-local",
    });
    expect(prepared).toBe(0);
  });

  it("returns the failed message without asking the gate when preparing throws", async () => {
    const seen: GateRequest[] = [];
    const tool = fakeTool({
      async prepare() {
        throw new Error("boom");
      },
    });

    const message = await gateRunToolCall(recordingGate(seen))(
      [tool],
      call,
    );

    expect(message.content).toBe(
      "[denied] Not executed. The policy check failed: boom",
    );
    expect(seen).toHaveLength(0);
  });

  it("returns the denial reason without running the prepared action when the gate denies", async () => {
    let ran = 0;
    const tool = fakeTool({
      async prepare() {
        return {
          reach: fileReach,
          run: async () => {
            ran += 1;
            return "ran-1";
          },
        };
      },
    });

    const message = await gateRunToolCall(
      recordingGate([], { allowed: false, reason: "no" }),
    )([tool], call);

    expect(message).toEqual({
      role: "tool",
      toolCallId: "c1",
      content:
        "[denied] Not executed. The policy gate rejected this action: no",
    });
    expect(ran).toBe(0);
  });

  it("returns the failed message and does not run when the gate throws", async () => {
    let ran = 0;
    const tool = fakeTool({
      async prepare() {
        return {
          reach: fileReach,
          run: async () => {
            ran += 1;
            return "ran-1";
          },
        };
      },
    });
    const gate: Gate = {
      judge: async () => {
        throw new Error("provider down");
      },
    };

    const message = await gateRunToolCall(gate)([tool], call);

    expect(message.content).toBe(
      "[denied] Not executed. The policy check failed: provider down",
    );
    expect(ran).toBe(0);
  });

  it("shows the callerMessage of a GateError", async () => {
    const gate: Gate = {
      judge: async () => {
        throw new GateError(
          "Gate judgement failed: Jev request failed: 503 upstream busy",
          {
            callerMessage:
              "Gate judgement failed: Jev request failed: 503 (text from the service left out)",
          },
        );
      },
    };

    const message = await gateRunToolCall(gate)([fakeTool()], call);

    expect(message.content).toBe(
      "[denied] Not executed. The policy check failed: Gate judgement failed: Jev request failed: 503 (text from the service left out)",
    );
  });

  it("rethrows an AbortError from the gate unchanged", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const gate: Gate = {
      judge: async () => {
        throw abortError;
      },
    };

    await expect(
      gateRunToolCall(gate)([fakeTool()], call),
    ).rejects.toBe(abortError);
  });

  it("rethrows a non-AbortError from the gate unchanged when the signal is already aborted", async () => {
    const timeoutError = new DOMException("timed out", "TimeoutError");
    const gate: Gate = {
      judge: async () => {
        throw timeoutError;
      },
    };
    const controller = new AbortController();
    controller.abort();

    await expect(
      gateRunToolCall(gate)([fakeTool()], call, {
        signal: controller.signal,
      }),
    ).rejects.toBe(timeoutError);
  });

  it("passes the context signal to the gate and to the prepared action", async () => {
    const controller = new AbortController();
    let gateContext: GateContext | undefined;
    let runContext: { signal?: AbortSignal } | undefined;
    const gate: Gate = {
      judge: async (_request, context): Promise<Verdict> => {
        gateContext = context;
        return { allowed: true, reason: "ok" };
      },
    };
    const tool = fakeTool({
      async prepare() {
        return {
          reach: fileReach,
          run: async (context) => {
            runContext = context;
            return "ran-1";
          },
        };
      },
    });

    await gateRunToolCall(gate)([tool], call, {
      signal: controller.signal,
    });

    expect(gateContext?.signal).toBe(controller.signal);
    expect(runContext?.signal).toBe(controller.signal);
  });

  it("passes parent as context.trace to the gate, and no trace when parent is missing", async () => {
    const parent: TraceSpan = {
      startSpan: () => parent,
      startRoot: () => parent,
      setAttributes: (): void => {},
      addEvent: (): void => {},
      end: (): void => {},
    };
    const contexts: (GateContext | undefined)[] = [];
    const gate: Gate = {
      judge: async (_request, context): Promise<Verdict> => {
        contexts.push(context);
        return { allowed: true, reason: "ok" };
      },
    };

    await gateRunToolCall(gate, undefined, parent)([fakeTool()], call);
    await gateRunToolCall(gate)([fakeTool()], call);

    expect(contexts[0]?.trace).toBe(parent);
    expect(contexts[1]).not.toHaveProperty("trace");
  });
});

describe("gateRunToolCall over trace", () => {
  class Span implements TraceSpan {
    readonly children: Span[] = [];
    readonly attributes: TraceAttributes = {};
    constructor(readonly name: string) {}
    startSpan(name: string, attributes?: TraceAttributes): TraceSpan {
      const child = new Span(name);
      Object.assign(child.attributes, attributes);
      this.children.push(child);
      return child;
    }
    startRoot(name: string): TraceSpan {
      return new Span(name);
    }
    setAttributes(attributes: TraceAttributes): void {
      Object.assign(this.attributes, attributes);
    }
    addEvent(): void {}
    end(): void {}
  }

  it("records no tool span for a denied call and one tool span with the result for an allowed call", async () => {
    const root = new Span("root");
    const gate: Gate = {
      judge: vi.fn(async (request): Promise<Verdict> => {
        const denied =
          (request.payload as ToolCallPayload).call.id === "denied";
        return denied
          ? { allowed: false, reason: "no" }
          : { allowed: true, reason: "ok" };
      }),
    };
    const run = gateRunToolCall(gate, tracePrepareToolCall(root), root);

    await run([fakeTool()], { id: "denied", name: "t", arguments: {} });
    await run([fakeTool()], {
      id: "allowed",
      name: "t",
      arguments: {},
    });

    const toolSpans = root.children.filter(
      (span) => span.name === SPAN.tool,
    );
    expect(toolSpans).toHaveLength(1);
    expect(toolSpans[0].attributes[ATTR.toolResult]).toBe("ran-1");
  });
});

describe("gateRunToolCall with a rules gate", () => {
  it("does not run a tool that declares a relative path", async () => {
    let ran = 0;
    const tool = fakeTool({
      name: "read_file",
      async prepare() {
        return {
          reach: {
            kind: "paths",
            paths: [
              {
                path: "src/a.ts" as AbsolutePath,
                extent: "file",
              },
            ],
          },
          run: async () => {
            ran += 1;
            return "read";
          },
        };
      },
    });

    const result = await gateRunToolCall(
      createRulesGate({ root: process.cwd(), rules: [] }),
    )([tool], { id: "call-1", name: "read_file", arguments: {} });

    expect(result.content).toBe(
      '[denied] Not executed. The policy check failed: Rules gate payload has a malformed reach: reach.paths[0].path must be an absolute path, got "src/a.ts"',
    );
    expect(ran).toBe(0);
  });
});
