import type {
  ClassifyRequest,
  Classification,
  Estimate,
  EstimateOptions,
  Estimator,
} from "@mg/core";
import { describe, expect, test } from "vitest";
import { createEstimatorWorkSpeechJudge } from "./work-speech.js";

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

const situation = {
  tools: [{ name: "search", arguments: '{"q":"天気"}', result: null }],
  elapsedMs: 4000,
};

const createJudge = (estimator: Estimator) =>
  createEstimatorWorkSpeechJudge({
    estimator,
    question: "作業中に何か話しますか。",
    report: "進みを伝える",
    fills: [{ text: "少々お待ちください", when: "少し待たせている" }],
    silent: "話すことはない",
  });

describe("createEstimatorWorkSpeechJudge", () => {
  test("returns the fill phrase for the chosen label and sends report, each fill, and silent as labels", async () => {
    const calls: ClassifyCall[] = [];
    const estimator = createFakeEstimator(
      () => ({
        label: "fill-0",
        probabilities: { report: 0.1, "fill-0": 0.8, silent: 0.1 },
      }),
      calls,
    );
    const judge = createJudge(estimator);

    await expect(judge.judge(situation)).resolves.toEqual({
      action: "fill",
      text: "少々お待ちください",
    });
    expect(calls[0][0]).toEqual({
      subject: situation,
      question: "作業中に何か話しますか。",
      labels: {
        report: "進みを伝える",
        "fill-0": "少し待たせている",
        silent: "話すことはない",
      },
    });
  });

  test("returns report when chosen, and silent when chosen", async () => {
    const reportEstimator = createFakeEstimator(() => ({
      label: "report",
      probabilities: { report: 0.8, "fill-0": 0.1, silent: 0.1 },
    }));
    const silentEstimator = createFakeEstimator(() => ({
      label: "silent",
      probabilities: { report: 0.1, "fill-0": 0.1, silent: 0.8 },
    }));

    await expect(
      createJudge(reportEstimator).judge(situation),
    ).resolves.toEqual({ action: "report" });
    await expect(
      createJudge(silentEstimator).judge(situation),
    ).resolves.toEqual({ action: "silent" });
  });
});
