import type { Estimator } from "@mg/core";
import type {
  ReportAnswer,
  ReportJudge,
  ReportSituation,
} from "../types.js";
import {
  assertLabelCount,
  assertQuestion,
  classifyJudge,
} from "./classify.js";

export type EstimatorReportJudgeOptions = {
  estimator: Estimator;
  question: string;
  speak: string;
  defer: string;
};

export const createEstimatorReportJudge = (
  options: EstimatorReportJudgeOptions,
): ReportJudge => {
  const { estimator, question, speak, defer: deferLabel } = options;

  assertQuestion(question);

  const labels: Record<string, string> = { speak, defer: deferLabel };
  assertLabelCount(labels, estimator.limits);

  return {
    judge: (situation: ReportSituation, context) =>
      classifyJudge<ReportAnswer>({
        estimator,
        name: "report",
        question,
        labels,
        situation,
        context,
        toAnswer: (label) => {
          if (label === "speak") return { action: "speak" };
          if (label === "defer") return { action: "defer" };
          return undefined;
        },
      }),
  };
};
