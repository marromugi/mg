import type {
  Estimate,
  EstimateOptions,
  EstimateRequest,
  Estimator,
  EstimatorLimits,
} from "@mg/core";
import {
  EstimatorRetryExhaustedError,
  EstimatorResponseError,
  EstimatorRequestError,
} from "@mg/core";
import { describe, expect, test } from "vitest";
import { withSampleRetry } from "./jev-estimator.ts";

type Step = { value: Estimate } | { error: unknown };

const createScriptedEstimator = (
  steps: Step[],
): Estimator & { calls: number } => {
  let calls = 0;
  return {
    model: "fake-model",
    limits: {
      minLabels: 1,
      maxLabels: 7,
      maxLevels: 4,
    } satisfies EstimatorLimits,
    estimate: async (
      _request: EstimateRequest,
      _options?: EstimateOptions,
    ): Promise<Estimate> => {
      const step = steps[calls];
      calls++;
      if (!step) throw new Error("scripted estimator ran out of steps");
      if ("error" in step) throw step.error;
      return step.value;
    },
    classify: () => {
      throw new Error("not scripted for this test");
    },
    score: () => {
      throw new Error("not scripted for this test");
    },
    get calls() {
      return calls;
    },
  };
};

const request: EstimateRequest = { subject: "T", question: "Q" };

const retryableTransportError = (
  retryAfterMs?: number,
): EstimatorRequestError =>
  new EstimatorRequestError("call failed", {
    cause: new Error("network"),
    retryable: true,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });

const recordingSleep = (delays: number[]) => {
  return async (ms: number): Promise<void> => {
    delays.push(ms);
  };
};

describe("withSampleRetry", () => {
  test("returns the result once a retryable failure is followed by success, waiting 1s then 2s", async () => {
    const delays: number[] = [];
    const inner = createScriptedEstimator([
      { error: retryableTransportError() },
      { error: retryableTransportError() },
      { value: { probability: 0.7 } },
    ]);
    const estimator = withSampleRetry(inner, {
      sleep: recordingSleep(delays),
    });

    await expect(estimator.estimate(request)).resolves.toEqual({
      probability: 0.7,
    });
    expect(inner.calls).toBe(3);
    expect(delays).toEqual([1000, 2000]);
  });

  test("throws the exhausted error with the third failure as cause after 3 attempts of a retryable failure", async () => {
    const delays: number[] = [];
    const thirdError = retryableTransportError();
    const inner = createScriptedEstimator([
      { error: retryableTransportError() },
      { error: retryableTransportError() },
      { error: thirdError },
    ]);
    const estimator = withSampleRetry(inner, {
      sleep: recordingSleep(delays),
    });

    const thrown = await estimator
      .estimate(request)
      .catch((caught: unknown) => caught);

    expect(thrown).toBeInstanceOf(EstimatorRetryExhaustedError);
    expect((thrown as EstimatorRetryExhaustedError).attempts).toBe(3);
    expect((thrown as EstimatorRetryExhaustedError).cause).toBe(
      thirdError,
    );
    expect(delays).toEqual([1000, 2000]);
  });

  test("throws the exhausted error at once without waiting when the failure's wait time exceeds 10s", async () => {
    const delays: number[] = [];
    const inner = createScriptedEstimator([
      { error: retryableTransportError(11000) },
    ]);
    const estimator = withSampleRetry(inner, {
      sleep: recordingSleep(delays),
    });

    const thrown = await estimator
      .estimate(request)
      .catch((caught: unknown) => caught);

    expect(thrown).toBeInstanceOf(EstimatorRetryExhaustedError);
    expect((thrown as EstimatorRetryExhaustedError).attempts).toBe(1);
    expect(delays).toEqual([]);
    expect(inner.calls).toBe(1);
  });

  test("waits the full 10s and retries when the failure's wait time is exactly 10s", async () => {
    const delays: number[] = [];
    const inner = createScriptedEstimator([
      { error: retryableTransportError(10000) },
      { value: { probability: 0.7 } },
    ]);
    const estimator = withSampleRetry(inner, {
      sleep: recordingSleep(delays),
    });

    await expect(estimator.estimate(request)).resolves.toEqual({
      probability: 0.7,
    });
    expect(delays).toEqual([10000]);
  });

  test("rethrows an unmarked failure as-is without retrying", async () => {
    const delays: number[] = [];
    const error = new EstimatorResponseError("bad shape");
    const inner = createScriptedEstimator([{ error }]);
    const estimator = withSampleRetry(inner, {
      sleep: recordingSleep(delays),
    });

    await expect(estimator.estimate(request)).rejects.toBe(error);
    expect(inner.calls).toBe(1);
    expect(delays).toEqual([]);
  });
});
