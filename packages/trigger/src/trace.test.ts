import type { TraceAttributes, TraceSpan } from "@mg/harness";
import { ATTR, SPAN } from "@mg/trace";
import { describe, expect, it } from "vitest";
import type { TriggerContext, TriggerDecision } from "./types.js";
import { withTriggerSpan } from "./trace.js";

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

  startRoot(name: string, attributes?: TraceAttributes): TraceSpan {
    return this.startSpan(name, attributes);
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

class BrokenSpan implements TraceSpan {
  startSpan(): TraceSpan {
    throw new Error("span broke");
  }

  startRoot(): TraceSpan {
    throw new Error("span broke");
  }

  setAttributes(): void {}

  addEvent(): void {}

  end(): void {}
}

describe("withTriggerSpan", () => {
  it("opens mg.trigger under the parent and records a fired decision", async () => {
    const root = new RecordingSpan("root");
    const context: TriggerContext = { trace: root };
    const decision: TriggerDecision = {
      fired: true,
      reason: "because",
    };

    const result = await withTriggerSpan(
      context,
      {},
      async () => decision,
    );

    expect(result).toEqual(decision);
    expect(root.children).toHaveLength(1);
    const span = root.children[0];
    expect(span.name).toBe(SPAN.trigger);
    expect(span.mergedAttributes).toEqual({
      [ATTR.op]: "trigger",
      [ATTR.triggerFired]: true,
      [ATTR.triggerReason]: "because",
    });
    expect(span.endCalls).toEqual([undefined]);
  });

  it("records a decision that did not fire", async () => {
    const root = new RecordingSpan("root");
    const context: TriggerContext = { trace: root };
    const decision: TriggerDecision = { fired: false, reason: "no" };

    await withTriggerSpan(context, {}, async () => decision);

    const span = root.children[0];
    expect(span.mergedAttributes[ATTR.triggerFired]).toBe(false);
    expect(span.mergedAttributes[ATTR.triggerReason]).toBe("no");
  });

  it("carries the extra attributes the implementation passes onto the span", async () => {
    const root = new RecordingSpan("root");
    const context: TriggerContext = { trace: root };

    await withTriggerSpan(
      context,
      { [ATTR.triggerModel]: "m-1" },
      async () => ({ fired: true, reason: "ok" }),
    );

    const span = root.children[0];
    expect(span.mergedAttributes[ATTR.triggerModel]).toBe("m-1");
  });

  it("returns the decision without recording when no context is given", async () => {
    const decision: TriggerDecision = {
      fired: true,
      reason: "because",
    };

    const result = await withTriggerSpan(
      undefined,
      {},
      async () => decision,
    );

    expect(result).toEqual(decision);
  });

  it("continues with the decision when the parent cannot start a child span", async () => {
    const context: TriggerContext = { trace: new BrokenSpan() };
    const decision: TriggerDecision = { fired: false, reason: "no" };

    const result = await withTriggerSpan(
      context,
      {},
      async () => decision,
    );

    expect(result).toEqual(decision);
  });

  it("ends the span with the error and rethrows when judging throws", async () => {
    const root = new RecordingSpan("root");
    const context: TriggerContext = { trace: root };
    const error = new Error("judge broke");

    await expect(
      withTriggerSpan(context, {}, async () => {
        throw error;
      }),
    ).rejects.toBe(error);

    const span = root.children[0];
    expect(span.endCalls).toEqual([error]);
  });
});
