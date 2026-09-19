import type {
  Estimate,
  EstimateOptions,
  EstimateRequest,
  Estimator,
} from "@mg/core";
import {
  EstimatorHttpError,
  EstimatorResponseError,
  EstimatorTransportError,
} from "@mg/core";
import type { TraceAttributes, TraceSpan } from "@mg/harness";
import { ATTR, SPAN } from "@mg/trace";
import { describe, expect, test, vi } from "vitest";
import { GateError } from "../errors.js";
import type { GateContext, GateRequest } from "../types.js";
import { createEstimatorGate } from "./index.js";

class RecordingSpan implements TraceSpan {
  readonly name: string;
  readonly attributes: TraceAttributes;
  readonly children: RecordingSpan[] = [];
  readonly setAttributesCalls: TraceAttributes[] = [];

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

  end(): void {}

  get mergedAttributes(): TraceAttributes {
    return Object.assign(
      {},
      this.attributes,
      ...this.setAttributesCalls,
    );
  }
}

const createFakeEstimator = (
  model: string,
  estimate: (
    request: EstimateRequest,
    options?: EstimateOptions,
  ) => Promise<Estimate>,
): Estimator => ({ model, estimate });

const ALLOWED_REASON = "The estimator judged this action acceptable.";
const DENIED_REASON = "The estimator judged this action unacceptable.";

const request: GateRequest = {
  kind: "tool-call",
  description: "Run: ls",
};

describe("createEstimatorGate", () => {
  test("allows when the probability meets the default threshold", async () => {
    const estimator = createFakeEstimator("m", async () => ({
      probability: 0.5,
    }));
    const gate = createEstimatorGate({ estimator, policy: "policy" });

    await expect(gate.judge(request)).resolves.toMatchObject({
      allowed: true,
    });
  });

  test("denies when the probability falls short of the default threshold", async () => {
    const estimator = createFakeEstimator("m", async () => ({
      probability: 0.49,
    }));
    const gate = createEstimatorGate({ estimator, policy: "policy" });

    await expect(gate.judge(request)).resolves.toMatchObject({
      allowed: false,
    });
  });

  test("denies when the probability falls short of a custom threshold", async () => {
    const estimator = createFakeEstimator("m", async () => ({
      probability: 0.79,
    }));
    const gate = createEstimatorGate({
      estimator,
      policy: "policy",
      threshold: 0.8,
    });

    await expect(gate.judge(request)).resolves.toMatchObject({
      allowed: false,
    });
  });

  test("allows when the probability meets a custom threshold", async () => {
    const estimator = createFakeEstimator("m", async () => ({
      probability: 0.8,
    }));
    const gate = createEstimatorGate({
      estimator,
      policy: "policy",
      threshold: 0.8,
    });

    await expect(gate.judge(request)).resolves.toMatchObject({
      allowed: true,
    });
  });

  test("the reason when allowed matches the fixed sentence exactly", async () => {
    const estimator = createFakeEstimator("m", async () => ({
      probability: 0.9,
    }));
    const gate = createEstimatorGate({ estimator, policy: "policy" });

    const verdict = await gate.judge(request);

    expect(verdict.reason).toBe(ALLOWED_REASON);
  });

  test("the reason when denied matches the fixed sentence exactly", async () => {
    const estimator = createFakeEstimator("m", async () => ({
      probability: 0.1,
    }));
    const gate = createEstimatorGate({ estimator, policy: "policy" });

    const verdict = await gate.judge(request);

    expect(verdict.reason).toBe(DENIED_REASON);
  });

  test("sends the kind and description as text and the policy with the fixed question as the question", async () => {
    const calls: EstimateRequest[] = [];
    const estimator = createFakeEstimator("m", async (req) => {
      calls.push(req);
      return { probability: 0.9 };
    });
    const gate = createEstimatorGate({
      estimator,
      policy: "Allow read-only commands.",
    });

    await gate.judge({ kind: "tool-call", description: "Run: ls" });

    expect(calls[0].text).toBe("Kind: tool-call\nRun: ls");
    expect(calls[0].question).toBe(
      "Allow read-only commands.\n\nIs it fine to run this action?",
    );
  });

  test("wraps an HTTP error from the estimator in a gate error with the original as cause", async () => {
    const original = new EstimatorHttpError(
      "Jev request failed: 500",
      500,
      "",
    );
    const estimator = createFakeEstimator("m", async () => {
      throw original;
    });
    const gate = createEstimatorGate({ estimator, policy: "policy" });

    const error = await gate
      .judge(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GateError);
    expect((error as GateError).message).toBe("Gate judgement failed");
    expect((error as GateError).cause).toBe(original);
  });

  test("wraps a transport error from the estimator in a gate error with the original as cause", async () => {
    const original = new EstimatorTransportError("Jev request failed", {
      cause: new Error("network down"),
    });
    const estimator = createFakeEstimator("m", async () => {
      throw original;
    });
    const gate = createEstimatorGate({ estimator, policy: "policy" });

    const error = await gate
      .judge(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GateError);
    expect((error as GateError).message).toBe("Gate judgement failed");
    expect((error as GateError).cause).toBe(original);
  });

  test("wraps a response error from the estimator in a gate error with the original as cause", async () => {
    const original = new EstimatorResponseError(
      "Jev response failed validation",
    );
    const estimator = createFakeEstimator("m", async () => {
      throw original;
    });
    const gate = createEstimatorGate({ estimator, policy: "policy" });

    const error = await gate
      .judge(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GateError);
    expect((error as GateError).message).toBe("Gate judgement failed");
    expect((error as GateError).cause).toBe(original);
  });

  test("rejects without calling the estimator when the signal is already aborted", async () => {
    const estimate = vi.fn(async () => ({ probability: 0.9 }));
    const estimator = createFakeEstimator("m", estimate);
    const gate = createEstimatorGate({ estimator, policy: "policy" });
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);

    const error = await gate
      .judge(request, { signal: controller.signal })
      .catch((thrown: unknown) => thrown);

    expect(error).toBe(reason);
    expect(estimate).not.toHaveBeenCalled();
  });

  test("passes the same signal through to the estimator", async () => {
    let receivedSignal: AbortSignal | undefined;
    const estimator = createFakeEstimator(
      "m",
      async (_req, options) => {
        receivedSignal = options?.signal;
        return { probability: 0.9 };
      },
    );
    const gate = createEstimatorGate({ estimator, policy: "policy" });
    const controller = new AbortController();

    await gate.judge(request, { signal: controller.signal });

    expect(receivedSignal).toBe(controller.signal);
  });

  test("lets an AbortError thrown by the estimator through unwrapped", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const estimator = createFakeEstimator("m", async () => {
      throw abortError;
    });
    const gate = createEstimatorGate({ estimator, policy: "policy" });

    const error = await gate
      .judge(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBe(abortError);
  });

  test("records exactly one mg.gate span with allowed, reason, model and the probability, and no child span", async () => {
    const estimator = createFakeEstimator("m-1", async () => ({
      probability: 0.9,
    }));
    const gate = createEstimatorGate({ estimator, policy: "policy" });
    const root = new RecordingSpan("root");
    const context: GateContext = { trace: root };

    await gate.judge(request, context);

    expect(root.children).toHaveLength(1);
    const gateSpan = root.children[0];
    expect(gateSpan.name).toBe(SPAN.gate);
    expect(gateSpan.mergedAttributes[ATTR.gateAllowed]).toBe(true);
    expect(gateSpan.mergedAttributes[ATTR.gateReason]).toBe(
      ALLOWED_REASON,
    );
    expect(gateSpan.mergedAttributes[ATTR.gateModel]).toBe("m-1");
    expect(gateSpan.mergedAttributes[ATTR.gateProbability]).toBe(0.9);
    expect(gateSpan.children).toHaveLength(0);
  });

  test("does not record a span and still judges once when context has no trace", async () => {
    const estimate = vi.fn(async () => ({ probability: 0.9 }));
    const estimator = createFakeEstimator("m", estimate);
    const gate = createEstimatorGate({ estimator, policy: "policy" });

    const verdict = await gate.judge(request);

    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBe(ALLOWED_REASON);
    expect(estimate).toHaveBeenCalledTimes(1);
  });

  test("accepts a threshold above 1 without throwing at creation, and denies at probability 1", async () => {
    const estimator = createFakeEstimator("m", async () => ({
      probability: 1,
    }));

    expect(() =>
      createEstimatorGate({
        estimator,
        policy: "policy",
        threshold: 2,
      }),
    ).not.toThrow();
    const gate = createEstimatorGate({
      estimator,
      policy: "policy",
      threshold: 2,
    });

    await expect(gate.judge(request)).resolves.toMatchObject({
      allowed: false,
    });
  });

  test("accepts a NaN threshold without throwing at creation, and denies at probability 1", async () => {
    const estimator = createFakeEstimator("m", async () => ({
      probability: 1,
    }));

    expect(() =>
      createEstimatorGate({
        estimator,
        policy: "policy",
        threshold: Number.NaN,
      }),
    ).not.toThrow();
    const gate = createEstimatorGate({
      estimator,
      policy: "policy",
      threshold: Number.NaN,
    });

    await expect(gate.judge(request)).resolves.toMatchObject({
      allowed: false,
    });
  });
});
