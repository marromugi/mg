import type { Estimator } from "@mg/core";
import {
  createRetryingEstimator,
  EstimatorRequestError,
} from "@mg/core";
import { describe, expect, test } from "vitest";
import {
  createTimedEstimator,
  timingSummary,
} from "./timed-estimator.ts";

describe("createTimedEstimator", () => {
  test("records each request separately when it sits inside a retrying estimator", async () => {
    let clock = 0;
    const takes = [100, 300, 50];
    let call = 0;
    const inner: Estimator = {
      model: "m",
      limits: { minLabels: 1, maxLabels: 2, maxLevels: 2 },
      estimate: async () => {
        clock += takes[call];
        call++;
        if (call < 3) {
          throw new EstimatorRequestError("down", {
            cause: new Error("x"),
            retryable: true,
          });
        }
        return { probability: 0.5 };
      },
      classify: () => {
        throw new Error("unused");
      },
      score: () => {
        throw new Error("unused");
      },
    };
    const timed = createTimedEstimator(inner, () => clock);
    const retrying = createRetryingEstimator({
      estimator: timed,
      maxAttempts: 3,
      delaysMs: [0, 0],
      maxDelayMs: 10,
      sleep: async () => {},
    });

    await retrying.estimate({ subject: "T", question: "Q" });

    expect(timed.durationsMs).toEqual([100, 300, 50]);
  });
});

describe("timingSummary", () => {
  test("gives the median and the slowest, averaging the middle two for an even count", () => {
    expect(timingSummary([300, 100, 200])).toEqual({
      requests: 3,
      medianMs: 200,
      slowestMs: 300,
    });
    expect(timingSummary([400, 100, 200, 300])).toEqual({
      requests: 4,
      medianMs: 250,
      slowestMs: 400,
    });
  });
});
