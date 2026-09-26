import type {
  ClassifyRequest,
  Classification,
  Estimate,
  EstimateOptions,
  Estimator,
  EstimatorLimits,
} from "@mg/core";
import { EstimatorTransportError } from "@mg/core";
import type { TraceAttributes, TraceSpan } from "@mg/harness";
import { ATTR, SPAN } from "@mg/trace";
import { describe, expect, test } from "vitest";
import { JudgeError } from "../errors.js";
import type { JudgeContext } from "../types.js";
import { createEstimatorStopJudge } from "./stop.js";

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

type ClassifyCall = [ClassifyRequest, EstimateOptions | undefined];

const createFakeEstimator = (
  respond: (
    request: ClassifyRequest,
    options: EstimateOptions | undefined,
  ) => Promise<Classification> | Classification,
  calls: ClassifyCall[] = [],
  limits: EstimatorLimits = { maxLabels: 255, maxLevels: 10 },
): Estimator => ({
  model: "fake-model",
  limits,
  estimate: (): Promise<Estimate> =>
    Promise.reject(new Error("not used")),
  classify: (request, options) => {
    calls.push([request, options]);
    return Promise.resolve(respond(request, options));
  },
  score: () => Promise.reject(new Error("not used")),
});

const question = "作業を止めてほしいと言っていますか。";
const stop = "止めてと言った";
const continueLabel = "それ以外";
const situation = { utterance: "止めて" };

describe("createEstimatorStopJudge", () => {
  test("returns stop and sends the situation, question and labels unchanged", async () => {
    const calls: ClassifyCall[] = [];
    const estimator = createFakeEstimator(
      () => ({
        label: "stop",
        probabilities: { stop: 1, continue: 0 },
      }),
      calls,
    );
    const judge = createEstimatorStopJudge({
      estimator,
      question,
      stop,
      continue: continueLabel,
    });

    await expect(judge.judge(situation)).resolves.toEqual({
      action: "stop",
    });
    expect(calls[0][0]).toEqual({
      subject: { utterance: "止めて" },
      question: "作業を止めてほしいと言っていますか。",
      labels: { stop: "止めてと言った", continue: "それ以外" },
    });
  });

  test("returns continue when the estimator chooses continue", async () => {
    const estimator = createFakeEstimator(() => ({
      label: "continue",
      probabilities: { stop: 0, continue: 1 },
    }));
    const judge = createEstimatorStopJudge({
      estimator,
      question,
      stop,
      continue: continueLabel,
    });

    await expect(judge.judge(situation)).resolves.toEqual({
      action: "continue",
    });
  });

  test("wraps a transport error from the estimator in a judgment failure with its name and cause", async () => {
    const original = new EstimatorTransportError("request failed", {
      cause: new Error("network down"),
    });
    const estimator = createFakeEstimator(() =>
      Promise.reject(original),
    );
    const judge = createEstimatorStopJudge({
      estimator,
      question,
      stop,
      continue: continueLabel,
    });

    const error = await judge
      .judge(situation)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(JudgeError);
    expect((error as JudgeError).judge).toBe("stop");
    expect((error as JudgeError).message).toBe(
      'Judgment "stop" failed',
    );
    expect((error as JudgeError).cause).toBe(original);
  });

  test("rethrows an abort from the estimator unchanged, not as a judgment failure", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const estimator = createFakeEstimator(() =>
      Promise.reject(abortError),
    );
    const judge = createEstimatorStopJudge({
      estimator,
      question,
      stop,
      continue: continueLabel,
    });

    const error = await judge
      .judge(situation)
      .catch((thrown: unknown) => thrown);

    expect(error).toBe(abortError);
  });

  test("fails the judgment when the estimator chooses a label that is not one of its own", async () => {
    const estimator = createFakeEstimator(() => ({
      label: "maybe",
      probabilities: { stop: 0.5, continue: 0.5 },
    }));
    const judge = createEstimatorStopJudge({
      estimator,
      question,
      stop,
      continue: continueLabel,
    });

    const error = await judge
      .judge(situation)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(JudgeError);
    expect((error as JudgeError).message).toBe(
      'Judgment "stop" failed: the estimator chose "maybe", which is not one of its labels',
    );
  });

  test("rejects a whitespace-only question at creation", () => {
    const estimator = createFakeEstimator(() => ({
      label: "stop",
      probabilities: { stop: 1, continue: 0 },
    }));

    const create = () =>
      createEstimatorStopJudge({
        estimator,
        question: "  ",
        stop,
        continue: continueLabel,
      });

    expect(create).toThrow(RangeError);
    expect(create).toThrow(/^question must not be empty$/);
  });

  test("passes the judge's own signal through to the estimator, and forwards the estimator's own abort rejection unchanged", async () => {
    const controller = new AbortController();
    let released: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      released = resolve;
    });
    let receivedSignal: AbortSignal | undefined;
    const estimator = createFakeEstimator(async (_request, options) => {
      receivedSignal = options?.signal;
      await gate;
      if (options?.signal?.aborted === true) {
        throw new DOMException("aborted", "AbortError");
      }
      return { label: "stop", probabilities: { stop: 1, continue: 0 } };
    });
    const judge = createEstimatorStopJudge({
      estimator,
      question,
      stop,
      continue: continueLabel,
    });
    const context: JudgeContext = { signal: controller.signal };

    const pending = judge.judge(situation, context);
    controller.abort(new Error("caller cancelled"));
    released?.();

    const error = await pending.catch((thrown: unknown) => thrown);

    expect(receivedSignal).toBe(controller.signal);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
  });

  test("resolves normally when the signal is released without being aborted", async () => {
    let released: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      released = resolve;
    });
    const estimator = createFakeEstimator(async (_request, options) => {
      await gate;
      if (options?.signal?.aborted === true) {
        throw new DOMException("aborted", "AbortError");
      }
      return { label: "stop", probabilities: { stop: 1, continue: 0 } };
    });
    const judge = createEstimatorStopJudge({
      estimator,
      question,
      stop,
      continue: continueLabel,
    });
    const controller = new AbortController();
    const context: JudgeContext = { signal: controller.signal };

    const pending = judge.judge(situation, context);
    released?.();

    await expect(pending).resolves.toEqual({ action: "stop" });
  });

  test("records the judge name, model, chosen label and probabilities on a child of the parent span", async () => {
    const estimator = createFakeEstimator(() => ({
      label: "stop",
      probabilities: { stop: 0.8, continue: 0.2 },
    }));
    const judge = createEstimatorStopJudge({
      estimator,
      question,
      stop,
      continue: continueLabel,
    });
    const root = new RecordingSpan("root");
    const context: JudgeContext = { trace: root };

    await judge.judge(situation, context);

    expect(root.children).toHaveLength(1);
    const span = root.children[0];
    expect(span.name).toBe(SPAN.turn);
    expect(span.mergedAttributes).toEqual({
      [ATTR.op]: "turn",
      [ATTR.turnJudge]: "stop",
      [ATTR.turnModel]: "fake-model",
      [ATTR.turnLabel]: "stop",
      [ATTR.turnProbabilities]: '{"stop":0.8,"continue":0.2}',
    });
  });

  test("closes the child span as failed when the judgment fails", async () => {
    const original = new EstimatorTransportError("request failed", {
      cause: new Error("network down"),
    });
    const estimator = createFakeEstimator(() =>
      Promise.reject(original),
    );
    const judge = createEstimatorStopJudge({
      estimator,
      question,
      stop,
      continue: continueLabel,
    });
    const root = new RecordingSpan("root");
    const context: JudgeContext = { trace: root };

    await judge.judge(situation, context).catch(() => undefined);

    expect(root.children).toHaveLength(1);
    const span = root.children[0];
    expect(span.endCalls).toHaveLength(1);
    expect(span.endCalls[0]).toBeInstanceOf(JudgeError);
  });

  test("returns the answer without error when no parent span is given", async () => {
    const estimator = createFakeEstimator(() => ({
      label: "stop",
      probabilities: { stop: 1, continue: 0 },
    }));
    const judge = createEstimatorStopJudge({
      estimator,
      question,
      stop,
      continue: continueLabel,
    });

    await expect(judge.judge(situation)).resolves.toEqual({
      action: "stop",
    });
  });
});
