import type { Estimator } from "@mg/core";
import type {
  OverlapAnswer,
  OverlapJudge,
  OverlapSituation,
} from "../types.js";
import {
  assertLabelCount,
  assertQuestion,
  classifyJudge,
} from "./classify.js";

export type EstimatorOverlapJudgeOptions = {
  estimator: Estimator;
  question: string;
  replace: string;
  queue: string;
};

export const createEstimatorOverlapJudge = (
  options: EstimatorOverlapJudgeOptions,
): OverlapJudge => {
  const { estimator, question, replace, queue } = options;

  assertQuestion(question);

  const labels: Record<string, string> = { replace, queue };
  assertLabelCount(labels, estimator.limits);

  return {
    judge: (situation: OverlapSituation, context) =>
      classifyJudge<OverlapAnswer>({
        estimator,
        name: "overlap",
        question,
        labels,
        situation,
        context,
        toAnswer: (label) => {
          if (label === "replace") return { action: "replace" };
          if (label === "queue") return { action: "queue" };
          return undefined;
        },
      }),
  };
};
