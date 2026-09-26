import type {
  ClassifyRequest,
  Classification,
  Estimate,
  EstimateOptions,
  Estimator,
} from "@mg/core";
import { describe, expect, test } from "vitest";
import { createEstimatorReportJudge } from "./report.js";

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

describe("createEstimatorReportJudge", () => {
  test("returns defer and sends the situation, question and labels unchanged", async () => {
    const calls: ClassifyCall[] = [];
    const estimator = createFakeEstimator(
      () => ({ label: "defer", probabilities: { speak: 0, defer: 1 } }),
      calls,
    );
    const judge = createEstimatorReportJudge({
      estimator,
      question: "いま結果を話してよいですか。",
      speak: "話してよい",
      defer: "まだ話さない",
    });
    const situation = {
      said: "天気を調べています。",
      result: "東京は晴れです。",
    };

    await expect(judge.judge(situation)).resolves.toEqual({
      action: "defer",
    });
    expect(calls[0][0]).toEqual({
      subject: {
        said: "天気を調べています。",
        result: "東京は晴れです。",
      },
      question: "いま結果を話してよいですか。",
      labels: { speak: "話してよい", defer: "まだ話さない" },
    });
  });
});
