import { noopSpan } from "@mg/harness";
import type { TraceAttributes, TraceSpan } from "@mg/harness";
import { ATTR, SPAN } from "@mg/trace";
import { describe, expect, it } from "vitest";
import type { GateContext, GateRequest, Verdict } from "./types.js";
import { withGateSpan } from "./trace.js";

class RecordingSpan implements TraceSpan {
  readonly name: string;
  readonly attributes: TraceAttributes;
  readonly children: RecordingSpan[] = [];
  readonly setAttributesCalls: TraceAttributes[] = [];
  readonly endCalls: unknown[] = [];

  constructor(name: string, attributes?: TraceAttributes) {
    this.name = name;
    this.attributes = attributes ?? {};
  }

  startSpan(name: string, attributes?: TraceAttributes): TraceSpan {
    const child = new RecordingSpan(name, attributes);
    this.children.push(child);
    return child;
  }

  setAttributes(attributes: TraceAttributes): void {
    this.setAttributesCalls.push(attributes);
  }

  addEvent(): void {}

  end(error?: unknown): void {
    this.endCalls.push(error);
  }

  get mergedAttributes(): TraceAttributes {
    return Object.assign(
      {},
      this.attributes,
      ...this.setAttributesCalls,
    );
  }
}

const request: GateRequest = {
  kind: "tool-call",
  description: "Runs `bash` with command: echo hi",
};

describe("withGateSpan", () => {
  it("opens mg.gate with kind, description and extra attributes, and records allowed and reason", async () => {
    const root = new RecordingSpan("root");
    const context: GateContext = { trace: root };
    const verdict: Verdict = {
      allowed: true,
      reason: "matches policy",
    };

    const result = await withGateSpan(
      context,
      request,
      { [ATTR.gateModel]: "m" },
      async () => verdict,
    );

    expect(result).toEqual(verdict);
    expect(root.children).toHaveLength(1);
    const span = root.children[0];
    expect(span.name).toBe(SPAN.gate);
    expect(span.mergedAttributes).toEqual({
      [ATTR.op]: "gate",
      [ATTR.gateKind]: request.kind,
      [ATTR.gateDescription]: request.description,
      [ATTR.gateModel]: "m",
      [ATTR.gateAllowed]: true,
      [ATTR.gateReason]: "matches policy",
    });
    expect(span.endCalls).toEqual([undefined]);
  });

  it("passes the span into body", async () => {
    const root = new RecordingSpan("root");
    const context: GateContext = { trace: root };
    let seen: TraceSpan | undefined;

    await withGateSpan(context, request, {}, async (span) => {
      seen = span;
      return { allowed: true, reason: "ok" };
    });

    expect(seen).toBe(root.children[0]);
  });

  it("ends the span with the error and rethrows when body throws", async () => {
    const root = new RecordingSpan("root");
    const context: GateContext = { trace: root };
    const error = new Error("boom");

    await expect(
      withGateSpan(context, request, {}, async () => {
        throw error;
      }),
    ).rejects.toBe(error);

    const span = root.children[0];
    expect(span.endCalls).toEqual([error]);
  });

  it("does not open a span when context.trace is missing", async () => {
    let seen: TraceSpan | undefined;

    const result = await withGateSpan(
      undefined,
      request,
      {},
      async (span) => {
        seen = span;
        return { allowed: true, reason: "ok" };
      },
    );

    expect(seen).toBe(noopSpan);
    expect(result).toEqual({ allowed: true, reason: "ok" });
  });

  it("does not open a span when context has no trace", async () => {
    let seen: TraceSpan | undefined;

    const result = await withGateSpan(
      { signal: undefined },
      request,
      {},
      async (span) => {
        seen = span;
        return { allowed: false, reason: "denied" };
      },
    );

    expect(seen).toBe(noopSpan);
    expect(result).toEqual({ allowed: false, reason: "denied" });
  });
});
