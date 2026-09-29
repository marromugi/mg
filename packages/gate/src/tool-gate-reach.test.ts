import type { Reach, Tool, ToolCall, ToolSchema } from "@mg/core";
import { runSubagentCall, type Subagent } from "@mg/harness";
import { describe, expect, it, vi } from "vitest";
import { gateRunToolCall, type ToolCallPayload } from "./tool-gate.js";
import type { Gate, GateRequest, Verdict } from "./types.js";

const schema: ToolSchema = {
  "~standard": {
    version: 1,
    vendor: "mg-test",
    validate: (value: unknown) => ({ value }),
    jsonSchema: {
      input: () => ({ type: "object" }),
      output: () => ({ type: "object" }),
    },
  },
};

const recordingGate = (seen: GateRequest[]): Gate => ({
  judge: vi.fn(async (request: GateRequest): Promise<Verdict> => {
    seen.push(request);
    return { allowed: true, reason: "ok" };
  }),
});

const readFile = (declared: Reach, seenArguments: unknown[]): Tool => ({
  name: "read_file",
  description: "Reads a file.",
  input: schema,
  reach: async (args: unknown) => {
    seenArguments.push(args);
    return declared;
  },
  execute: async () => "contents",
});

const run = vi.fn(async (_callees: unknown, call: ToolCall) => ({
  role: "tool" as const,
  toolCallId: call.id,
  content: "done",
}));

describe("gateRunToolCall reach", () => {
  it("sends the gate the reach the tool declared for the arguments", async () => {
    const seen: GateRequest[] = [];
    const seenArguments: unknown[] = [];
    const declared: Reach = {
      kind: "paths",
      paths: [{ path: "/x/a.txt", extent: "file" }],
    };

    await gateRunToolCall(recordingGate(seen), run)(
      [readFile(declared, seenArguments)],
      { id: "c1", name: "read_file", arguments: { path: "a.txt" } },
    );

    const payload = seen[0].payload as ToolCallPayload;
    expect(payload.reach).toEqual({
      kind: "paths",
      paths: [{ path: "/x/a.txt", extent: "file" }],
    });
    expect(seenArguments).toEqual([{ path: "a.txt" }]);
  });

  it("sends the gate the reach a subagent declared", async () => {
    const seen: GateRequest[] = [];
    const helper: Subagent = {
      name: "helper",
      description: "Helps.",
      input: schema,
      reach: async () => ({ kind: "none" }),
      start: async () => "done",
    };

    await gateRunToolCall(recordingGate(seen), runSubagentCall)(
      [helper],
      { id: "c2", name: "helper", arguments: { prompt: "x" } },
    );

    const payload = seen[0].payload as ToolCallPayload;
    expect(payload.reach).toEqual({ kind: "none" });
  });

  it("sends any-local and no tool definition when no callee has the name", async () => {
    const seen: GateRequest[] = [];

    await gateRunToolCall(recordingGate(seen), run)(
      [readFile({ kind: "none" }, [])],
      { id: "c3", name: "nope", arguments: {} },
    );

    const payload = seen[0].payload as ToolCallPayload;
    expect(payload.reach).toEqual({ kind: "any-local" });
    expect(payload.tool).toBeUndefined();
  });

  it("returns the failed message without asking the gate or running when the declaration throws", async () => {
    const seen: GateRequest[] = [];
    const gate = recordingGate(seen);
    const execute = vi.fn(async () => "contents");
    const callee: Tool = {
      name: "read_file",
      input: schema,
      reach: async () => {
        throw new Error("boom");
      },
      execute,
    };

    const result = await gateRunToolCall(gate)([callee], {
      id: "c4",
      name: "read_file",
      arguments: {},
    });

    expect(result.content).toBe(
      "[denied] Not executed. The policy check failed: boom",
    );
    expect(gate.judge).toHaveBeenCalledTimes(0);
    expect(execute).toHaveBeenCalledTimes(0);
  });
});
