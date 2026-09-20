import { describe, expect, expectTypeOf, test, vi } from "vitest";
import type { HarnessInput } from "./types.js";
import {
  noopSpan,
  type TraceAttributes,
  type TraceSpan,
  withSpan,
} from "./trace.js";

describe("noopSpan", () => {
  test("startSpan returns itself", () => {
    expect(noopSpan.startSpan("x")).toBe(noopSpan);
  });

  test("startRoot returns itself", () => {
    expect(noopSpan.startRoot("x")).toBe(noopSpan);
  });

  test("every method is a no-op", () => {
    expect(() => noopSpan.startSpan("x", { a: 1 })).not.toThrow();
    expect(() => noopSpan.setAttributes({ a: 1 })).not.toThrow();
    expect(() => noopSpan.addEvent("x", { a: 1 })).not.toThrow();
    expect(() => noopSpan.end()).not.toThrow();
    expect(() => noopSpan.end(new Error("boom"))).not.toThrow();
  });
});

class RecordingSpan implements TraceSpan {
  startSpanCalls: { name: string; attributes?: TraceAttributes }[] = [];
  endCalls: unknown[] = [];

  startSpan(name: string, attributes?: TraceAttributes): TraceSpan {
    this.startSpanCalls.push({ name, attributes });
    return this;
  }

  setAttributes(): void {}

  addEvent(): void {}

  end(error?: unknown): void {
    this.endCalls.push(error);
  }
}

describe("withSpan", () => {
  test("starts a span, runs fn, and ends it with no error on success", async () => {
    const parent = new RecordingSpan();
    const fn = vi.fn(async (span: TraceSpan) => {
      expect(span).toBe(parent);
      return "result";
    });

    const result = await withSpan(parent, "name", { a: 1 }, fn);

    expect(result).toBe("result");
    expect(parent.startSpanCalls).toEqual([
      { name: "name", attributes: { a: 1 } },
    ]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(parent.endCalls).toEqual([undefined]);
  });

  test("ends the span with the error and rethrows it when fn rejects", async () => {
    const parent = new RecordingSpan();
    const error = new Error("boom");
    const fn = async () => {
      throw error;
    };

    await expect(withSpan(parent, "name", undefined, fn)).rejects.toBe(
      error,
    );
    expect(parent.endCalls).toEqual([error]);
    expect(parent.endCalls).toHaveLength(1);
  });
});

describe("HarnessInput", () => {
  test("accepts an object without trace", () => {
    const input: HarnessInput = { messages: [] };

    expectTypeOf(input).toExtend<HarnessInput>();
  });

  test("trace accepts noopSpan", () => {
    const input: HarnessInput = { messages: [], trace: noopSpan };

    expectTypeOf(input.trace).toEqualTypeOf<TraceSpan | undefined>();
  });
});
