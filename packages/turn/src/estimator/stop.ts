import type { Estimator } from "@mg/core";
import type { StopAnswer, StopJudge, StopSituation } from "../types.js";
import {
  assertLabelCount,
  assertQuestion,
  classifyJudge,
} from "./classify.js";

export type EstimatorStopJudgeOptions = {
  estimator: Estimator;
  question: string;
  stop: string;
  continue: string;
};

export const createEstimatorStopJudge = (
  options: EstimatorStopJudgeOptions,
): StopJudge => {
  const {
    estimator,
    question,
    stop,
    continue: continueLabel,
  } = options;

  assertQuestion(question);

  const labels: Record<string, string> = {
    stop,
    continue: continueLabel,
  };
  assertLabelCount(labels, estimator.limits);

  return {
    judge: (situation: StopSituation, context) =>
      classifyJudge<StopAnswer>({
        estimator,
        name: "stop",
        question,
        labels,
        situation,
        context,
        toAnswer: (label) => {
          if (label === "stop") return { action: "stop" };
          if (label === "continue") return { action: "continue" };
          return undefined;
        },
      }),
  };
};
