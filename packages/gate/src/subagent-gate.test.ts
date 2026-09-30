import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ToolCall, ToolSchema } from "@mg/core";
import {
  prepareSubagentCall,
  SubagentNotFoundError,
  type Subagent,
  type SubagentContext,
  type TraceSpan,
} from "@mg/harness";
import { SPAN, tracePrepareSubagentCall } from "@mg/trace";
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

type Start = (
  input: unknown,
  context: SubagentContext,
) => Promise<string>;

const stubResearcher = (
  run: Start,
): Subagent & { start: ReturnType<typeof vi.fn<Start>> } => {
  const start = vi.fn(run);
  return {
    name: "researcher",
    description: "Finds things out.",
    input: promptSchema,
    async prepare(input) {
      return {
        reach: { kind: "none" },
        run: (context) => start(input, context),
      };
    },
    start,
  };
};

const stubGate = (judge: Gate["judge"]): Gate => ({ judge });

const call: ToolCall = {
  id: "c1",
  name: "researcher",
  arguments: { prompt: "x" },
};

describe("gateRunToolCall with prepareSubagentCall", () => {
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

    const result = await gateRunToolCall(gate, prepareSubagentCall)(
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

    const result = await gateRunToolCall(gate, prepareSubagentCall)(
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

  it("sends the gate the reach the subagent declared", async () => {
    let seenRequest: GateRequest | undefined;
    const gate = stubGate(async (request): Promise<Verdict> => {
      seenRequest = request;
      return { allowed: true, reason: "ok" };
    });

    await gateRunToolCall(gate, prepareSubagentCall)(
      [stubResearcher(async () => "done")],
      call,
    );

    expect(seenRequest).toMatchObject({
      payload: { reach: { kind: "none" } },
    });
  });

  it("judges any-local and rejects with SubagentNotFoundError when the name is not found", async () => {
    let seenRequest: GateRequest | undefined;
    const gate = stubGate(async (request): Promise<Verdict> => {
      seenRequest = request;
      return { allowed: true, reason: "ok" };
    });

    const outcome = gateRunToolCall(gate, prepareSubagentCall)(
      [stubResearcher(async () => "done")],
      { id: "c2", name: "nope", arguments: {} },
    );

    await expect(outcome).rejects.toBeInstanceOf(SubagentNotFoundError);
    await expect(outcome).rejects.toThrow(
      "No subagent named nope for call c2",
    );
    expect(seenRequest).toMatchObject({
      payload: { reach: { kind: "any-local" } },
    });
  });

  it("sends the gate a tool-call request naming the subagent", async () => {
    let seenRequest: GateRequest | undefined;
    const gate = stubGate(async (request): Promise<Verdict> => {
      seenRequest = request;
      return { allowed: true, reason: "ok" };
    });
    const researcher = stubResearcher(async () => "done");

    await gateRunToolCall(gate, prepareSubagentCall)(
      [researcher],
      call,
    );

    expect(seenRequest?.kind).toBe("tool-call");
    const payload = seenRequest?.payload as ToolCallPayload;
    expect(payload.call).toBe(call);
    expect(payload.tool?.name).toBe("researcher");
  });

  it("denies a subagent call blocked by a name rule in the rules gate", async () => {
    const gate = createRulesGate({
      root: realpathSync(tmpdir()),
      rules: [
        {
          tools: ["researcher"],
          allowed: false,
          reason: "no delegation",
        },
      ],
    });
    const researcher = stubResearcher(async () => "done");

    const result = await gateRunToolCall(gate, prepareSubagentCall)(
      [researcher],
      call,
    );

    expect(result.content).toBe(
      "[denied] Not executed. The policy gate rejected this action: no delegation",
    );
  });
});

describe("gateRunToolCall over trace with a subagent", () => {
  class Span implements TraceSpan {
    readonly children: Span[] = [];
    readonly roots: Span[] = [];
    constructor(readonly name: string) {}
    startSpan(name: string): TraceSpan {
      const child = new Span(name);
      this.children.push(child);
      return child;
    }
    startRoot(name: string): TraceSpan {
      const root = new Span(name);
      this.roots.push(root);
      return root;
    }
    setAttributes(): void {}
    addEvent(): void {}
    end(): void {}
  }

  it("records a subagent span with a thread span under it and hands the thread span to the subagent", async () => {
    const root = new Span("root");
    const gate = stubGate(async (): Promise<Verdict> => ({
      allowed: true,
      reason: "ok",
    }));
    const researcher = stubResearcher(
      async (_input, context) => (context.trace as Span).name,
    );

    const result = await gateRunToolCall(
      gate,
      tracePrepareSubagentCall(root),
      root,
    )([researcher], call);

    expect(result.content).toBe(SPAN.thread);
    expect(root.children.map((span) => span.name)).toEqual([
      SPAN.subagent,
    ]);
    expect(root.children[0].roots.map((span) => span.name)).toEqual([
      SPAN.thread,
    ]);
  });
});
