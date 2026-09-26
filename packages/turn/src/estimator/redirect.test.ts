import type {
  ClassifyRequest,
  Classification,
  Estimate,
  EstimateOptions,
  Estimator,
} from "@mg/core";
import { describe, expect, test } from "vitest";
import { createEstimatorRedirectJudge } from "./redirect.js";

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

describe("createEstimatorRedirectJudge", () => {
  test("returns switch and sends the exchanges, request, question and labels unchanged", async () => {
    const calls: ClassifyCall[] = [];
    const estimator = createFakeEstimator(
      () => ({
        label: "switch",
        probabilities: { switch: 1, continue: 0 },
      }),
      calls,
    );
    const judge = createEstimatorRedirectJudge({
      estimator,
      question: "話の向きが変わりましたか。",
      switch: "別のことを頼んだ",
      continue: "それ以外",
    });
    const situation = {
      exchanges: [
        { utterance: "天気を調べて", reply: "調べます" },
        { utterance: "東京の天気ね", reply: "東京ですね" },
        { utterance: "やっぱり株価を調べて", reply: "わかりました" },
      ],
      request: "天気を調べて",
    };

    await expect(judge.judge(situation)).resolves.toEqual({
      action: "switch",
    });
    expect(calls[0][0]).toEqual({
      subject: situation,
      question: "話の向きが変わりましたか。",
      labels: { switch: "別のことを頼んだ", continue: "それ以外" },
    });
    expect(calls[0][0].subject).toEqual({
      exchanges: [
        { utterance: "天気を調べて", reply: "調べます" },
        { utterance: "東京の天気ね", reply: "東京ですね" },
        { utterance: "やっぱり株価を調べて", reply: "わかりました" },
      ],
      request: "天気を調べて",
    });
  });
});
