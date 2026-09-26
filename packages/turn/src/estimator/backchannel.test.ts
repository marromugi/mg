import type {
  ClassifyRequest,
  Classification,
  Estimate,
  EstimateOptions,
  Estimator,
  EstimatorLimits,
} from "@mg/core";
import { describe, expect, test } from "vitest";
import { createEstimatorBackchannelJudge } from "./backchannel.js";

type ClassifyCall = [ClassifyRequest, EstimateOptions | undefined];

const createFakeEstimator = (
  respond: (request: ClassifyRequest) => Classification,
  calls: ClassifyCall[] = [],
  limits: EstimatorLimits = { maxLabels: 255, maxLevels: 10 },
): Estimator => ({
  model: "fake-model",
  limits,
  estimate: (): Promise<Estimate> =>
    Promise.reject(new Error("not used")),
  classify: (request, options) => {
    calls.push([request, options]);
    return Promise.resolve(respond(request));
  },
  score: () => Promise.reject(new Error("not used")),
});

describe("createEstimatorBackchannelJudge", () => {
  test("returns the phrase for the chosen label and sends each phrase and none as labels", async () => {
    const calls: ClassifyCall[] = [];
    const estimator = createFakeEstimator(
      () => ({
        label: "backchannel-1",
        probabilities: {
          "backchannel-0": 0.1,
          "backchannel-1": 0.8,
          none: 0.1,
        },
      }),
      calls,
    );
    const judge = createEstimatorBackchannelJudge({
      estimator,
      question: "相づちを打ちますか。",
      phrases: [
        { text: "うん", when: "軽くうなずく" },
        { text: "なるほど", when: "納得を示す" },
      ],
      none: "相づちは要らない",
    });

    await expect(judge.judge({ interim: "" })).resolves.toEqual({
      action: "backchannel",
      text: "なるほど",
    });
    expect(calls[0][0].labels).toEqual({
      "backchannel-0": "軽くうなずく",
      "backchannel-1": "納得を示す",
      none: "相づちは要らない",
    });
  });

  test("returns none when the estimator chooses none", async () => {
    const estimator = createFakeEstimator(() => ({
      label: "none",
      probabilities: {
        "backchannel-0": 0.1,
        "backchannel-1": 0.1,
        none: 0.8,
      },
    }));
    const judge = createEstimatorBackchannelJudge({
      estimator,
      question: "相づちを打ちますか。",
      phrases: [
        { text: "うん", when: "軽くうなずく" },
        { text: "なるほど", when: "納得を示す" },
      ],
      none: "相づちは要らない",
    });

    await expect(judge.judge({ interim: "" })).resolves.toEqual({
      action: "none",
    });
  });

  test("rejects a phrase text given more than once at creation", () => {
    const estimator = createFakeEstimator(() => ({
      label: "none",
      probabilities: { "backchannel-0": 0, none: 1 },
    }));

    const create = () =>
      createEstimatorBackchannelJudge({
        estimator,
        question: "相づちを打ちますか。",
        phrases: [
          { text: "うん", when: "軽くうなずく" },
          { text: "うん", when: "納得を示す" },
        ],
        none: "相づちは要らない",
      });

    expect(create).toThrow(RangeError);
    expect(create).toThrow(/^phrase "うん" is given more than once$/);
  });

  test("rejects a label count over the estimator's limit at creation", () => {
    const estimator = createFakeEstimator(
      () => ({ label: "none", probabilities: { none: 1 } }),
      [],
      { maxLabels: 2, maxLevels: 10 },
    );

    const create = () =>
      createEstimatorBackchannelJudge({
        estimator,
        question: "相づちを打ちますか。",
        phrases: [
          { text: "うん", when: "軽くうなずく" },
          { text: "なるほど", when: "納得を示す" },
        ],
        none: "相づちは要らない",
      });

    expect(create).toThrow(RangeError);
    expect(create).toThrow(
      /^3 labels exceed the estimator limit of 2$/,
    );
  });
});
