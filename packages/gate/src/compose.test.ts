import type { TraceSpan } from "@mg/harness";
import { describe, expect, test, vi } from "vitest";
import { composeGates } from "./compose.js";
import type {
  Gate,
  GateContext,
  GateRequest,
  Verdict,
} from "./types.js";

const stubGate = (judge: Gate["judge"]): Gate => ({ judge });

const request: GateRequest = { kind: "tool-call", description: "test" };

describe("composeGates", () => {
  test("throws a RangeError when given an empty array", () => {
    expect(() => composeGates([])).toThrow(RangeError);
    expect(() => composeGates([])).toThrow(
      "composeGates needs at least one gate",
    );
  });

  test("passes a single gate's verdict through unchanged", async () => {
    const verdict: Verdict = { allowed: false, reason: "denied" };
    const gate = stubGate(async () => verdict);

    const composed = composeGates([gate]);

    await expect(composed.judge(request)).resolves.toBe(verdict);
  });

  test("short-circuits on the first denial and does not call later gates", async () => {
    const first = vi.fn(async (): Promise<Verdict> => ({
      allowed: true,
      reason: "first ok",
    }));
    const denyingVerdict: Verdict = {
      allowed: false,
      reason: "second denies",
    };
    const second = vi.fn(async (): Promise<Verdict> => denyingVerdict);
    const third = vi.fn(async (): Promise<Verdict> => ({
      allowed: true,
      reason: "third ok",
    }));

    const composed = composeGates([
      stubGate(first),
      stubGate(second),
      stubGate(third),
    ]);

    const verdict = await composed.judge(request);

    expect(verdict).toBe(denyingVerdict);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).not.toHaveBeenCalled();
  });

  test("allows with a reason naming the count when every gate allows", async () => {
    const gates = [
      stubGate(async () => ({ allowed: true, reason: "a" })),
      stubGate(async () => ({ allowed: true, reason: "b" })),
      stubGate(async () => ({ allowed: true, reason: "c" })),
    ];

    const composed = composeGates(gates);

    await expect(composed.judge(request)).resolves.toEqual({
      allowed: true,
      reason: "All 3 gates allowed.",
    });
  });

  test("propagates an error from an inner gate and does not call later gates", async () => {
    const error = new Error("judgement failed");
    const first = vi.fn(async () => {
      throw error;
    });
    const second = vi.fn(async (): Promise<Verdict> => ({
      allowed: true,
      reason: "ok",
    }));

    const composed = composeGates([stubGate(first), stubGate(second)]);

    await expect(composed.judge(request)).rejects.toBe(error);
    expect(second).not.toHaveBeenCalled();
  });

  test("hands the same context to every inner gate", async () => {
    const controller = new AbortController();
    const span: TraceSpan = {
      startSpan: () => span,
      setAttributes: (): void => {},
      addEvent: (): void => {},
      end: (): void => {},
    };
    const context: GateContext = {
      signal: controller.signal,
      trace: span,
    };
    const seen: (GateContext | undefined)[] = [];
    const recording =
      (): Gate["judge"] =>
      async (_request: GateRequest, ctx?: GateContext) => {
        seen.push(ctx);
        return { allowed: true, reason: "ok" };
      };

    const composed = composeGates([
      stubGate(recording()),
      stubGate(recording()),
    ]);

    await composed.judge(request, context);

    expect(seen).toEqual([context, context]);
  });
});
