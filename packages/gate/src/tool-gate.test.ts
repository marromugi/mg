import {
  defineTool,
  type Tool,
  type ToolCall,
  type ToolMessage,
  type ToolSchema,
} from "@mg/core";
import { describe, expect, it, vi } from "vitest";
import type {
  Gate,
  GateContext,
  GateRequest,
  Verdict,
} from "./types.js";
import {
  gateRunToolCall,
  TOOL_CALL_KIND,
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

const weatherTool: Tool = defineTool({
  name: "weather",
  description: "Reports the weather for a city.",
  input: schema,
  execute: async () => "sunny",
});

const call: ToolCall = {
  id: "call-1",
  name: "weather",
  arguments: { city: "tokyo" },
};

const stubGate = (judge: Gate["judge"]): Gate => ({ judge });

describe("toToolCallRequest", () => {
  it("builds a tool-call request with name, description and arguments", () => {
    const request = toToolCallRequest([weatherTool], call);

    expect(request.kind).toBe(TOOL_CALL_KIND);
    expect(request.description).toContain("Tool: weather");
    expect(request.description).toContain(
      "Description: Reports the weather for a city.",
    );
    expect(request.description).toContain(
      JSON.stringify(call.arguments, null, 2),
    );

    const payload = request.payload as ToolCallPayload;
    expect(payload.call).toBe(call);
    expect(payload.tool).toEqual({
      name: "weather",
      description: "Reports the weather for a city.",
      input: schema,
    });
    expect(payload.tool).not.toHaveProperty("execute");
  });

  it("describes a tool without a description as (none)", () => {
    const tool: Tool = defineTool({
      name: "weather",
      input: schema,
      execute: async () => "sunny",
    });

    const request = toToolCallRequest([tool], call);

    expect(request.description).toContain("Description: (none)");
  });

  it("describes an unknown tool as (unknown tool) with payload.tool undefined", () => {
    const request = toToolCallRequest([], call);

    expect(request.description).toContain(
      "Description: (unknown tool)",
    );
    const payload = request.payload as ToolCallPayload;
    expect(payload.tool).toBeUndefined();
  });
});

describe("gateRunToolCall", () => {
  it("calls run with the same arguments and returns its result when allowed", async () => {
    const judge = vi.fn(async (): Promise<Verdict> => ({
      allowed: true,
      reason: "ok",
    }));
    const gate = stubGate(judge);
    const message: ToolMessage = {
      role: "tool",
      toolCallId: "call-1",
      content: "sunny",
    };
    const run = vi.fn(async () => message);

    const result = await gateRunToolCall(gate, run)(
      [weatherTool],
      call,
      undefined,
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith([weatherTool], call, undefined);
    expect(result).toBe(message);
  });

  it("does not call run and returns the reason when denied", async () => {
    const gate = stubGate(async (): Promise<Verdict> => ({
      allowed: false,
      reason: "writes to disk",
    }));
    const run = vi.fn();

    const result = await gateRunToolCall(gate, run)(
      [weatherTool],
      call,
    );

    expect(run).not.toHaveBeenCalled();
    expect(result.toolCallId).toBe(call.id);
    expect(result.content).toContain("[denied]");
    expect(result.content).toContain("writes to disk");
  });

  it("does not call run and returns a failure message when the gate throws", async () => {
    const gate = stubGate(async () => {
      throw new Error("provider down");
    });
    const run = vi.fn();

    const result = await gateRunToolCall(gate, run)(
      [weatherTool],
      call,
    );

    expect(run).not.toHaveBeenCalled();
    expect(result.toolCallId).toBe(call.id);
    expect(result.content).toContain("[denied]");
    expect(result.content).toContain("provider down");
  });

  it("rethrows an AbortError from the gate unchanged without calling run", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const gate = stubGate(async () => {
      throw abortError;
    });
    const run = vi.fn();

    await expect(
      gateRunToolCall(gate, run)([weatherTool], call),
    ).rejects.toBe(abortError);
    expect(run).not.toHaveBeenCalled();
  });

  it("passes the context signal to the gate", async () => {
    const controller = new AbortController();
    let seenContext: GateContext | undefined;
    const gate = stubGate(
      async (
        _request: GateRequest,
        context?: GateContext,
      ): Promise<Verdict> => {
        seenContext = context;
        return { allowed: true, reason: "ok" };
      },
    );
    const run = vi.fn(async (): Promise<ToolMessage> => ({
      role: "tool",
      toolCallId: call.id,
      content: "sunny",
    }));

    await gateRunToolCall(gate, run)([weatherTool], call, {
      signal: controller.signal,
    });

    expect(seenContext?.signal).toBe(controller.signal);
  });

  it("uses runToolCall by default", async () => {
    const gate = stubGate(async (): Promise<Verdict> => ({
      allowed: true,
      reason: "ok",
    }));

    const result = await gateRunToolCall(gate)([weatherTool], call);

    expect(result).toEqual({
      role: "tool",
      toolCallId: call.id,
      content: "sunny",
    });
  });
});
