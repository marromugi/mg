import { ATTR, SPAN } from "@mg/trace";
import type { SessionTree, SpanRecord } from "@mg/trace/store";
import { buildSessionTree } from "@mg/trace/store";
import { describe, expect, it, vi } from "vitest";
import { evaluate } from "./evaluate.js";
import type { Check, CheckOutcome, EvalInput } from "./types.js";
import * as viewModule from "./view.js";

const record = (
  overrides: Partial<SpanRecord> & Pick<SpanRecord, "spanId">,
): SpanRecord => ({
  sessionId: "session-1",
  serviceName: "svc",
  traceId: "trace-1",
  parentSpanId: undefined,
  name: "span",
  startTime: "2026-01-01T00:00:00.000Z",
  endTime: "2026-01-01T00:00:01.000Z",
  attributes: {},
  events: [],
  status: { code: 0 },
  ...overrides,
});

const buildSession = (): SessionTree => {
  const session = buildSessionTree([
    record({
      spanId: "run",
      name: SPAN.run,
      attributes: {
        [ATTR.op]: "run",
        [ATTR.runName]: "my-run",
        [ATTR.runCase]: "case-1",
      },
    }),
  ]);
  if (session === undefined) throw new Error("session not built");
  return session;
};

const makeCheck = (
  name: string,
  evaluateFn: Check["evaluate"],
): Check => ({ name, evaluate: evaluateFn });

const passing = (name: string, reason = "ok"): Check =>
  makeCheck(name, async (): Promise<CheckOutcome> => ({
    passed: true,
    reason,
  }));

const failing = (name: string, reason = "no good"): Check =>
  makeCheck(name, async (): Promise<CheckOutcome> => ({
    passed: false,
    reason,
  }));

describe("evaluate", () => {
  it("keeps results in the same order as the checks array", async () => {
    const session = buildSession();

    const verdict = await evaluate(session, [
      passing("a"),
      failing("b"),
      passing("c"),
    ]);

    expect(verdict.checks.map((result) => result.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(verdict.checks.map((result) => result.status)).toEqual([
      "passed",
      "failed",
      "passed",
    ]);
  });

  it("does not stop later checks when one fails", async () => {
    const session = buildSession();
    const third = vi.fn(async (): Promise<CheckOutcome> => ({
      passed: true,
      reason: "ok",
    }));

    const verdict = await evaluate(session, [
      failing("a"),
      failing("b"),
      makeCheck("c", third),
    ]);

    expect(third).toHaveBeenCalledTimes(1);
    expect(verdict.passed).toBe(false);
    expect(verdict.checks[2]).toMatchObject({
      name: "c",
      status: "passed",
    });
  });

  it("turns a throwing check into a status: error result and keeps going", async () => {
    const session = buildSession();
    const boom = new Error("boom");
    const third = vi.fn(async (): Promise<CheckOutcome> => ({
      passed: true,
      reason: "ok",
    }));

    const verdict = await evaluate(session, [
      passing("a"),
      makeCheck("b", async () => {
        throw boom;
      }),
      makeCheck("c", third),
    ]);

    expect(third).toHaveBeenCalledTimes(1);
    expect(verdict.passed).toBe(false);
    expect(verdict.checks[1]).toEqual({
      name: "b",
      status: "error",
      message: "boom",
      error: boom,
    });
  });

  it("stringifies a thrown non-Error value into the message", async () => {
    const session = buildSession();

    const verdict = await evaluate(session, [
      makeCheck("a", async () => {
        throw "not an error";
      }),
    ]);

    expect(verdict.checks[0]).toEqual({
      name: "a",
      status: "error",
      message: "not an error",
      error: "not an error",
    });
  });

  it("rethrows an AbortError from a check instead of recording it", async () => {
    const session = buildSession();
    const abortError = new DOMException("aborted", "AbortError");

    await expect(
      evaluate(session, [
        makeCheck("a", async () => {
          throw abortError;
        }),
      ]),
    ).rejects.toBe(abortError);
  });

  it("throws before any check runs when the signal is already aborted", async () => {
    const session = buildSession();
    const controller = new AbortController();
    controller.abort();
    const check = vi.fn();

    await expect(
      evaluate(session, [makeCheck("a", check)], {
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(check).not.toHaveBeenCalled();
  });

  it("passes when the checks array is empty", async () => {
    const session = buildSession();

    const verdict = await evaluate(session, []);

    expect(verdict.passed).toBe(true);
    expect(verdict.checks).toEqual([]);
  });

  it("computes the view once and passes the same object to every check", async () => {
    const session = buildSession();
    const spy = vi.spyOn(viewModule, "viewRun");
    const seen: EvalInput["view"][] = [];

    await evaluate(session, [
      makeCheck("a", async (input) => {
        seen.push(input.view);
        return { passed: true, reason: "ok" };
      }),
      makeCheck("b", async (input) => {
        seen.push(input.view);
        return { passed: true, reason: "ok" };
      }),
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);

    spy.mockRestore();
  });
});
