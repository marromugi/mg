import type {
  Estimate,
  EstimateOptions,
  EstimateRequest,
  Estimator,
} from "@mg/core";
import { EstimatorResponseError } from "@mg/core";
import type { TraceAttributes, TraceSpan } from "@mg/harness";
import { ATTR, SPAN } from "@mg/trace";
import { describe, expect, expectTypeOf, test, vi } from "vitest";
import { GateError } from "../errors.js";
import type { GateContext, GateRequest } from "../types.js";
import {
  createEstimatorGate,
  type EstimatorGateOptions,
} from "./index.js";

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

const createFakeEstimator = (
  model: string,
  estimate: (
    request: EstimateRequest,
    options?: EstimateOptions,
  ) => Promise<Estimate>,
): Estimator => ({
  model,
  limits: { maxLabels: 255, maxLevels: 10 },
  estimate,
  classify: () => Promise.reject(new Error("not used")),
  score: () => Promise.reject(new Error("not used")),
});

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
    const gate = createEstimatorGate({
      estimator,
      question: "question",
    });

    await expect(gate.judge(request)).resolves.toMatchObject({
      allowed: true,
    });
  });

  test("denies when the probability falls short of the default threshold", async () => {
    const estimator = createFakeEstimator("m", async () => ({
      probability: 0.49,
    }));
    const gate = createEstimatorGate({
      estimator,
      question: "question",
    });

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
      question: "question",
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
      question: "question",
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
    const gate = createEstimatorGate({
      estimator,
      question: "question",
    });

    const verdict = await gate.judge(request);

    expect(verdict.reason).toBe(ALLOWED_REASON);
  });

  test("the reason when denied matches the fixed sentence exactly", async () => {
    const estimator = createFakeEstimator("m", async () => ({
      probability: 0.1,
    }));
    const gate = createEstimatorGate({
      estimator,
      question: "question",
    });

    const verdict = await gate.judge(request);

    expect(verdict.reason).toBe(DENIED_REASON);
  });

  test("sends the question as given and the kind line with the description as the subject", async () => {
    const calls: EstimateRequest[] = [];
    const estimator = createFakeEstimator("m", async (req) => {
      calls.push(req);
      return { probability: 0.9 };
    });
    const gate = createEstimatorGate({
      estimator,
      question: "  Is this command read-only?\n",
    });

    await gate.judge({ kind: "tool-call", description: "Run: ls" });

    expect(calls[0].subject).toBe("Kind: tool-call\nRun: ls");
    expect(calls[0].question).toBe("  Is this command read-only?\n");
  });

  test("rejects an empty or whitespace-only question at creation", () => {
    const estimator = createFakeEstimator("m", async () => ({
      probability: 1,
    }));

    for (const question of ["", " \n\t "]) {
      const create = () => createEstimatorGate({ estimator, question });

      expect(create).toThrow(RangeError);
      expect(create).toThrow(/^question must not be empty$/);
    }
  });

  test("reports the threshold error first when both threshold and question are invalid", () => {
    const estimator = createFakeEstimator("m", async () => ({
      probability: 1,
    }));

    expect(() =>
      createEstimatorGate({ estimator, question: "", threshold: 2 }),
    ).toThrow(/^threshold must be between 0 and 1$/);
  });

  test("requires a question and has no policy option", () => {
    type Options = EstimatorGateOptions;
    type NoQuestion = { estimator: Estimator };

    // @ts-expect-error policy is not an option
    expectTypeOf<Options>().toHaveProperty("policy");
    // @ts-expect-error question is required
    expectTypeOf<NoQuestion>().toMatchTypeOf<Options>();

    expect(true).toBe(true);
  });

  test("states the estimator's full reason in message and leaves the service text out of callerMessage", async () => {
    const original = new EstimatorResponseError(
      "Jev response is not JSON",
      {
        cause: new SyntaxError("Unexpected token '<'"),
        causeQuotesService: true,
      },
    );
    const gate = createEstimatorGate({
      estimator: createFakeEstimator("m", async () => {
        throw original;
      }),
      question: "question",
    });

    const error = await gate
      .judge(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GateError);
    expect((error as GateError).message).toBe(
      "Gate judgement failed: Jev response is not JSON: Unexpected token '<'",
    );
    expect((error as GateError).callerMessage).toBe(
      "Gate judgement failed: Jev response is not JSON: (text from the service left out)",
    );
    expect((error as GateError).cause).toBe(original);
  });

  test("uses the same text for message and callerMessage when the estimator error quotes no service text", async () => {
    const gate = createEstimatorGate({
      estimator: createFakeEstimator("m", async () => {
        throw new EstimatorResponseError(
          "Jev response failed validation",
        );
      }),
      question: "question",
    });

    const error = await gate
      .judge(request)
      .catch((thrown: unknown) => thrown);

    expect((error as GateError).message).toBe(
      "Gate judgement failed: Jev response failed validation",
    );
    expect((error as GateError).callerMessage).toBe(
      "Gate judgement failed: Jev response failed validation",
    );
  });

  test("ends the gate span with the full message under a trace", async () => {
    const gate = createEstimatorGate({
      estimator: createFakeEstimator("m", async () => {
        throw new EstimatorResponseError("Jev response is not JSON", {
          cause: new SyntaxError("Unexpected token '<'"),
          causeQuotesService: true,
        });
      }),
      question: "question",
    });
    const root = new RecordingSpan("root");

    await gate.judge(request, { trace: root }).catch(() => {});

    const ended = root.children[0].endCalls[0] as Error;
    expect(ended.message).toBe(
      "Gate judgement failed: Jev response is not JSON: Unexpected token '<'",
    );
  });

  test("rejects without calling the estimator when the signal is already aborted", async () => {
    const estimate = vi.fn(async () => ({ probability: 0.9 }));
    const estimator = createFakeEstimator("m", estimate);
    const gate = createEstimatorGate({
      estimator,
      question: "question",
    });
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
    const gate = createEstimatorGate({
      estimator,
      question: "question",
    });
    const controller = new AbortController();

    await gate.judge(request, { signal: controller.signal });

    expect(receivedSignal).toBe(controller.signal);
  });

  test("lets an AbortError thrown by the estimator through unwrapped", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const estimator = createFakeEstimator("m", async () => {
      throw abortError;
    });
    const gate = createEstimatorGate({
      estimator,
      question: "question",
    });

    const error = await gate
      .judge(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBe(abortError);
  });

  test("records exactly one mg.gate span with allowed, reason, model and the probability, and no child span", async () => {
    const estimator = createFakeEstimator("m-1", async () => ({
      probability: 0.9,
    }));
    const gate = createEstimatorGate({
      estimator,
      question: "question",
    });
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
    const gate = createEstimatorGate({
      estimator,
      question: "question",
    });

    const verdict = await gate.judge(request);

    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toBe(ALLOWED_REASON);
    expect(estimate).toHaveBeenCalledTimes(1);
  });

  test("rejects a threshold of 2, -0.1, NaN, or Infinity at creation", () => {
    const estimator = createFakeEstimator("m", async () => ({
      probability: 1,
    }));

    for (const threshold of [
      2,
      -0.1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      const create = () =>
        createEstimatorGate({
          estimator,
          question: "question",
          threshold,
        });

      expect(create).toThrow(RangeError);
      expect(create).toThrow(/^threshold must be between 0 and 1$/);
    }
  });

  test("creates a gate at a threshold of 0, and allows at a probability of 0", async () => {
    const estimator = createFakeEstimator("m", async () => ({
      probability: 0,
    }));
    const gate = createEstimatorGate({
      estimator,
      question: "question",
      threshold: 0,
    });

    await expect(gate.judge(request)).resolves.toMatchObject({
      allowed: true,
    });
  });

  test("creates a gate at a threshold of 1, and denies at 0.99 but allows at 1", async () => {
    let calls = 0;
    const estimator = createFakeEstimator("m", async () => ({
      probability: calls++ === 0 ? 0.99 : 1,
    }));
    const gate = createEstimatorGate({
      estimator,
      question: "question",
      threshold: 1,
    });

    await expect(gate.judge(request)).resolves.toMatchObject({
      allowed: false,
    });
    await expect(gate.judge(request)).resolves.toMatchObject({
      allowed: true,
    });
  });
});
