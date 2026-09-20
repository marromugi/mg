import type { ToolCall, ToolSchema } from "@mg/core";
import {
  runSubagentCall,
  type Subagent,
  type TraceSpan,
} from "@mg/harness";
import { describe, expect, it, vi } from "vitest";
import { createRulesGate } from "./rules/index.js";
import { gateRunToolCall, type ToolCallPayload } from "./tool-gate.js";
import type { Gate, GateRequest, Verdict } from "./types.js";

const stubSpan = (): TraceSpan => ({
  startSpan: () => stubSpan(),
  startRoot: () => stubSpan(),
  setAttributes: () => {},
  addEvent: () => {},
  end: () => {},
});

const promptSchema: ToolSchema = {
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

const stubResearcher = (start: Subagent["start"]): Subagent => ({
  name: "researcher",
  description: "Finds things out.",
  input: promptSchema,
  start: vi.fn(start),
});

const stubGate = (judge: Gate["judge"]): Gate => ({ judge });

const call: ToolCall = {
  id: "c1",
  name: "researcher",
  arguments: { prompt: "x" },
};

describe("gateRunToolCall with runSubagentCall", () => {
  it("starts the subagent with the given context and returns its result when the gate allows it", async () => {
    const gate = stubGate(async (): Promise<Verdict> => ({
      allowed: true,
      reason: "ok",
    }));
    const received: { trace?: TraceSpan } = {};
    const researcher = stubResearcher(async (_input, context) => {
      received.trace = context.trace;
      return "done";
    });
    const controller = new AbortController();
    const trace = stubSpan();

    const result = await gateRunToolCall(gate, runSubagentCall)(
      [researcher],
      call,
      { signal: controller.signal, trace },
    );

    expect(result.content).toBe("done");
    expect(received.trace).toBe(trace);
  });

  it("does not start the subagent and returns the denial reason when the gate rejects it", async () => {
    const gate = stubGate(async (): Promise<Verdict> => ({
      allowed: false,
      reason: "not now",
    }));
    const researcher = stubResearcher(async () => "done");

    const result = await gateRunToolCall(gate, runSubagentCall)(
      [researcher],
      call,
    );

    expect(result).toEqual({
      role: "tool",
      toolCallId: "c1",
      content:
        "[denied] Not executed. The policy gate rejected this action: not now",
    });
    expect(researcher.start).not.toHaveBeenCalled();
  });

  it("sends the gate a tool-call request naming the subagent", async () => {
    let seenRequest: GateRequest | undefined;
    const gate = stubGate(async (request): Promise<Verdict> => {
      seenRequest = request;
      return { allowed: true, reason: "ok" };
    });
    const researcher = stubResearcher(async () => "done");

    await gateRunToolCall(gate, runSubagentCall)([researcher], call);

    expect(seenRequest?.kind).toBe("tool-call");
    const payload = seenRequest?.payload as ToolCallPayload;
    expect(payload.call).toBe(call);
    expect(payload.tool?.name).toBe("researcher");
  });

  it("denies a subagent call blocked by a name rule in the rules gate", async () => {
    const gate = createRulesGate({
      root: "/repo",
      rules: [
        {
          tools: ["researcher"],
          allowed: false,
          reason: "no delegation",
        },
      ],
    });
    const researcher = stubResearcher(async () => "done");

    const result = await gateRunToolCall(gate, runSubagentCall)(
      [researcher],
      call,
    );

    expect(result.content).toBe(
      "[denied] Not executed. The policy gate rejected this action: no delegation",
    );
  });
});
