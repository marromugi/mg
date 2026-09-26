import type { Estimator } from "@mg/core";
import type {
  RedirectAnswer,
  RedirectJudge,
  RedirectSituation,
} from "../types.js";
import {
  assertLabelCount,
  assertQuestion,
  classifyJudge,
} from "./classify.js";

export type EstimatorRedirectJudgeOptions = {
  estimator: Estimator;
  question: string;
  switch: string;
  continue: string;
};

export const createEstimatorRedirectJudge = (
  options: EstimatorRedirectJudgeOptions,
): RedirectJudge => {
  const {
    estimator,
    question,
    switch: switchLabel,
    continue: continueLabel,
  } = options;

  assertQuestion(question);

  const labels: Record<string, string> = {
    switch: switchLabel,
    continue: continueLabel,
  };
  assertLabelCount(labels, estimator.limits);

  return {
    judge: (situation: RedirectSituation, context) =>
      classifyJudge<RedirectAnswer>({
        estimator,
        name: "redirect",
        question,
        labels,
        situation,
        context,
        toAnswer: (label) => {
          if (label === "switch") return { action: "switch" };
          if (label === "continue") return { action: "continue" };
          return undefined;
        },
      }),
  };
};
