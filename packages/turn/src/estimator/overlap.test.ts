import type {
  ClassifyRequest,
  Classification,
  Estimate,
  EstimateOptions,
  Estimator,
} from "@mg/core";
import { describe, expect, test } from "vitest";
import { createEstimatorOverlapJudge } from "./overlap.js";

type ClassifyCall = [ClassifyRequest, EstimateOptions | undefined];

const createFakeEstimator = (
  respond: (request: ClassifyRequest) => Classification,
  calls: ClassifyCall[] = [],
): Estimator => ({
  model: "fake-model",
  limits: { maxLabels: 255, maxLevels: 10 },
  estimate: (): Promise<Estimate> =>
    Promise.reject(new Error("not used")),
  classify: (request, options) => {
    calls.push([request, options]);
    return Promise.resolve(respond(request));
  },
  score: () => Promise.reject(new Error("not used")),
});

describe("createEstimatorOverlapJudge", () => {
  test("returns queue and sends the situation, question and labels unchanged", async () => {
    const calls: ClassifyCall[] = [];
    const estimator = createFakeEstimator(
      () => ({
        label: "queue",
        probabilities: { replace: 0, queue: 1 },
      }),
      calls,
    );
    const judge = createEstimatorOverlapJudge({
      estimator,
      question: "新しい頼みは今の作業を置き換えますか。",
      replace: "置き換える",
      queue: "あとで別にやる",
    });
    const situation = {
      running: "天気を調べて",
      request: "株価も調べて",
    };

    await expect(judge.judge(situation)).resolves.toEqual({
      action: "queue",
    });
    expect(calls[0][0]).toEqual({
      subject: { running: "天気を調べて", request: "株価も調べて" },
      question: "新しい頼みは今の作業を置き換えますか。",
      labels: { replace: "置き換える", queue: "あとで別にやる" },
    });
  });
});
