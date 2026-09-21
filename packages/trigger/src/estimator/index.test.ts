import type {
  Estimate,
  EstimateOptions,
  EstimateRequest,
  Estimator,
} from "@mg/core";
import { EstimatorTransportError } from "@mg/core";
import type { TraceAttributes, TraceSpan } from "@mg/harness";
import { ATTR, SPAN } from "@mg/trace";
import { describe, expect, test } from "vitest";
import { TriggerError } from "../errors.js";
import type { TriggerContext } from "../types.js";
import type { TextTriggerInput } from "./index.js";
import { createEstimatorTrigger } from "./index.js";

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

  startRoot(name: string, attributes?: TraceAttributes): TraceSpan {
    return this.startSpan(name, attributes);
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
  probability: number,
  calls: [EstimateRequest, EstimateOptions | undefined][] = [],
): Estimator => ({
  model: "fake-model",
  estimate: (
    request: EstimateRequest,
    options?: EstimateOptions,
  ): Promise<Estimate> => {
    calls.push([request, options]);
    return Promise.resolve({ probability });
  },
});

const prompt = "Fire when the assistant could help.";
const input: TextTriggerInput = {
  kind: "tweet",
  text: "そういえば明日何かあったっけ",
};

describe("createEstimatorTrigger", () => {
  test("fires with the default threshold when the probability is above it", async () => {
    const estimator = createFakeEstimator(0.82);
    const trigger = createEstimatorTrigger({ estimator, prompt });

    await expect(trigger.decide(input)).resolves.toEqual({
      fired: true,
      reason: "Probability 0.82 is at or above the threshold 0.7.",
    });
  });

  test("does not fire with the default threshold when the probability is below it", async () => {
    const estimator = createFakeEstimator(0.41);
    const trigger = createEstimatorTrigger({ estimator, prompt });

    await expect(trigger.decide(input)).resolves.toEqual({
      fired: false,
      reason: "Probability 0.41 is below the threshold 0.7.",
    });
  });

  test("fires with the default threshold when the probability equals it", async () => {
    const estimator = createFakeEstimator(0.7);
    const trigger = createEstimatorTrigger({ estimator, prompt });

    await expect(trigger.decide(input)).resolves.toEqual({
      fired: true,
      reason: "Probability 0.7 is at or above the threshold 0.7.",
    });
  });

  test("does not fire with a custom threshold when the probability falls short of it", async () => {
    const estimator = createFakeEstimator(0.82);
    const trigger = createEstimatorTrigger({
      estimator,
      prompt,
      threshold: 0.9,
    });

    await expect(trigger.decide(input)).resolves.toEqual({
      fired: false,
      reason: "Probability 0.82 is below the threshold 0.9.",
    });
  });

  test("sends the kind and text as text and the prompt with the fixed question as the question", async () => {
    const calls: [EstimateRequest, EstimateOptions | undefined][] = [];
    const estimator = createFakeEstimator(0.5, calls);
    const trigger = createEstimatorTrigger({ estimator, prompt });

    await trigger.decide(input);

    expect(calls[0][0]).toEqual({
      text: "Kind: tweet\nそういえば明日何かあったっけ",
      question:
        "Fire when the assistant could help.\n\nShould a run be started for this input?",
    });
  });

  test("rejects a threshold of 1.5, -0.1, or NaN at creation, but not 0 or 1", () => {
    const estimator = createFakeEstimator(1);

    for (const threshold of [1.5, -0.1, Number.NaN]) {
      const create = () =>
        createEstimatorTrigger({ estimator, prompt, threshold });

      expect(create).toThrow(RangeError);
      expect(create).toThrow(/^threshold must be between 0 and 1$/);
    }

    for (const threshold of [0, 1]) {
      const create = () =>
        createEstimatorTrigger({ estimator, prompt, threshold });

      expect(create).not.toThrow();
    }
  });

  test("wraps a transport error from the estimator in a trigger error with the original as cause", async () => {
    const original = new EstimatorTransportError(
      "Estimator request failed",
      { cause: new Error("network down") },
    );
    const estimator: Estimator = {
      model: "fake-model",
      estimate: () => Promise.reject(original),
    };
    const trigger = createEstimatorTrigger({ estimator, prompt });

    const error = await trigger
      .decide(input)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(TriggerError);
    expect((error as TriggerError).name).toBe("TriggerError");
    expect((error as TriggerError).message).toBe(
      "Trigger judgement failed",
    );
    expect((error as TriggerError).cause).toBe(original);
  });

  test("lets an error that is not from the estimator through unchanged", async () => {
    const original = new Error("boom");
    const estimator: Estimator = {
      model: "fake-model",
      estimate: () => Promise.reject(original),
    };
    const trigger = createEstimatorTrigger({ estimator, prompt });

    const error = await trigger
      .decide(input)
      .catch((thrown: unknown) => thrown);

    expect(error).toBe(original);
  });

  test("rejects without calling the estimator when the signal is already aborted", async () => {
    const calls: [EstimateRequest, EstimateOptions | undefined][] = [];
    const estimator = createFakeEstimator(0.9, calls);
    const trigger = createEstimatorTrigger({ estimator, prompt });
    const controller = new AbortController();
    const reason = new Error("stop");
    controller.abort(reason);
    const context: TriggerContext = { signal: controller.signal };

    const error = await trigger
      .decide(input, context)
      .catch((thrown: unknown) => thrown);

    expect(error).toBe(reason);
    expect(calls).toHaveLength(0);
  });

  test("passes the same signal through to the estimator", async () => {
    const calls: [EstimateRequest, EstimateOptions | undefined][] = [];
    const estimator = createFakeEstimator(0.9, calls);
    const trigger = createEstimatorTrigger({ estimator, prompt });
    const controller = new AbortController();
    const context: TriggerContext = { signal: controller.signal };

    await trigger.decide(input, context);

    expect(calls[0][1]?.signal).toBe(controller.signal);
  });

  test("records the model, probability, threshold, fired and reason on the trigger span under the parent, without the input's kind or text", async () => {
    const estimator = createFakeEstimator(0.82);
    const trigger = createEstimatorTrigger({
      estimator,
      prompt,
      threshold: 0.9,
    });
    const root = new RecordingSpan("root");
    const context: TriggerContext = { trace: root };

    await trigger.decide(input, context);

    expect(root.children).toHaveLength(1);
    const span = root.children[0];
    expect(span.name).toBe(SPAN.trigger);
    expect(span.mergedAttributes).toEqual({
      [ATTR.op]: "trigger",
      [ATTR.triggerModel]: "fake-model",
      [ATTR.triggerProbability]: 0.82,
      [ATTR.triggerThreshold]: 0.9,
      [ATTR.triggerFired]: false,
      [ATTR.triggerReason]:
        "Probability 0.82 is below the threshold 0.9.",
    });
    for (const value of Object.values(span.mergedAttributes)) {
      expect(String(value)).not.toContain("tweet");
      expect(String(value)).not.toContain(
        "そういえば明日何かあったっけ",
      );
    }
  });
});
