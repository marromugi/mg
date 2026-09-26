import type { TraceAttributes, TraceSpan } from "@mg/harness";
import { ATTR, SPAN } from "@mg/trace";
import { describe, expect, it } from "vitest";
import type { JudgeContext } from "./types.js";
import { withTurnSpan } from "./trace.js";

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

describe("withTurnSpan", () => {
  it("opens mg.turn under the parent with the judge name and extra attributes", async () => {
    const root = new RecordingSpan("root");
    const context: JudgeContext = { trace: root };

    const result = await withTurnSpan(
      context,
      "stop",
      { [ATTR.turnModel]: "fake-model" },
      async () => ({ action: "stop" }),
    );

    expect(result).toEqual({ action: "stop" });
    expect(root.children).toHaveLength(1);
    const span = root.children[0];
    expect(span.name).toBe(SPAN.turn);
    expect(span.mergedAttributes).toEqual({
      [ATTR.op]: "turn",
      [ATTR.turnJudge]: "stop",
      [ATTR.turnModel]: "fake-model",
    });
    expect(span.endCalls).toEqual([undefined]);
  });

  it("lets the body add its own attributes to the span", async () => {
    const root = new RecordingSpan("root");
    const context: JudgeContext = { trace: root };

    await withTurnSpan(context, "stop", {}, async (span) => {
      span.setAttributes({ [ATTR.turnLabel]: "stop" });
      return { action: "stop" };
    });

    const span = root.children[0];
    expect(span.mergedAttributes[ATTR.turnLabel]).toBe("stop");
  });

  it("runs the body with a no-op span when no context is given", async () => {
    const result = await withTurnSpan(
      undefined,
      "stop",
      {},
      async () => ({ action: "stop" }),
    );

    expect(result).toEqual({ action: "stop" });
  });

  it("continues with the body's result when the parent cannot start a child span", async () => {
    const context: JudgeContext = { trace: new BrokenSpan() };

    const result = await withTurnSpan(
      context,
      "stop",
      {},
      async () => ({
        action: "stop",
      }),
    );

    expect(result).toEqual({ action: "stop" });
  });

  it("ends the span with the error and rethrows when the body throws", async () => {
    const root = new RecordingSpan("root");
    const context: JudgeContext = { trace: root };
    const error = new Error("judge broke");

    await expect(
      withTurnSpan(context, "stop", {}, async () => {
        throw error;
      }),
    ).rejects.toBe(error);

    const span = root.children[0];
    expect(span.endCalls).toEqual([error]);
  });

  it("does not record anything when no parent span is given", async () => {
    const result = await withTurnSpan(
      { trace: undefined },
      "stop",
      {},
      async () => ({ action: "continue" }),
    );

    expect(result).toEqual({ action: "continue" });
  });
});
