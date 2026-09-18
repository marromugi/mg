import { describe, expect, it } from "vitest";
import { rule } from "./rule.js";
import type { EvalInput } from "./types.js";
import type { RunView } from "./view.js";

const makeView = (overrides: Partial<RunView> = {}): RunView => ({
  sessionId: "session-1",
  steps: [],
  llmSteps: [],
  toolSteps: [],
  gateSteps: [],
  turnCount: 0,
  finalText: undefined,
  usage: { inputTokens: 0, outputTokens: 0 },
  startTime: "2026-01-01T00:00:00.000Z",
  endTime: "2026-01-01T00:00:01.000Z",
  ...overrides,
});

const makeInput = (view: RunView): EvalInput => ({
  session: {
    sessionId: view.sessionId,
    serviceName: "svc",
    startTime: view.startTime,
    endTime: view.endTime,
    traces: [],
  },
  view,
});

describe("rule", () => {
  it("maps a true predicate to a passed outcome with the default reason", async () => {
    const check = rule("always-true", () => true);
    const input = makeInput(makeView());

    const outcome = await check.evaluate(input);

    expect(outcome).toEqual({ passed: true, reason: "rule passed" });
  });

  it("maps a false predicate to a failed outcome with the default reason", async () => {
    const check = rule("always-false", () => false);
    const input = makeInput(makeView());

    const outcome = await check.evaluate(input);

    expect(outcome).toEqual({ passed: false, reason: "rule failed" });
  });

  it("keeps a custom reason and details from an object outcome", async () => {
    const check = rule("with-details", () => ({
      passed: false,
      reason: "too many calls",
      details: { count: 4 },
    }));
    const input = makeInput(makeView());

    const outcome = await check.evaluate(input);

    expect(outcome).toEqual({
      passed: false,
      reason: "too many calls",
      details: { count: 4 },
    });
  });

  it("falls back to the default reason when an object outcome omits it", async () => {
    const check = rule("no-reason", () => ({ passed: true }));
    const input = makeInput(makeView());

    const outcome = await check.evaluate(input);

    expect(outcome).toEqual({ passed: true, reason: "rule passed" });
  });

  it("awaits an async predicate", async () => {
    const check = rule("async", async () => {
      await Promise.resolve();
      return true;
    });
    const input = makeInput(makeView());

    const outcome = await check.evaluate(input);

    expect(outcome.passed).toBe(true);
  });

  it("passes the view from EvalInput to the predicate", async () => {
    const view = makeView({ sessionId: "session-42", turnCount: 3 });
    const input = makeInput(view);
    let seenView: RunView | undefined;
    let seenInput: EvalInput | undefined;

    const check = rule("sees-view", (v, i) => {
      seenView = v;
      seenInput = i;
      return true;
    });

    await check.evaluate(input);

    expect(seenView).toBe(view);
    expect(seenInput).toBe(input);
  });

  it("lets an error thrown by the predicate propagate", async () => {
    const boom = new Error("boom");
    const check = rule("throws", () => {
      throw boom;
    });
    const input = makeInput(makeView());

    await expect(check.evaluate(input)).rejects.toBe(boom);
  });

  it("rejects an empty name", () => {
    expect(() => rule("", () => true)).toThrow(RangeError);
  });
});
