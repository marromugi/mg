import type { Estimator } from "@mg/core";
import type {
  WorkSpeechAnswer,
  WorkSpeechJudge,
  WorkSpeechSituation,
} from "../types.js";
import {
  assertLabelCount,
  assertPhrasesUnique,
  assertQuestion,
  classifyJudge,
  type PhraseChoice,
} from "./classify.js";

export type EstimatorWorkSpeechJudgeOptions = {
  estimator: Estimator;
  question: string;
  report: string;
  fills: readonly [PhraseChoice, ...PhraseChoice[]];
  silent: string;
};

const labelForIndex = (index: number): string => `fill-${index}`;

export const createEstimatorWorkSpeechJudge = (
  options: EstimatorWorkSpeechJudgeOptions,
): WorkSpeechJudge => {
  const { estimator, question, report, fills, silent } = options;

  assertQuestion(question);
  assertPhrasesUnique(fills);

  const labels: Record<string, string> = { report };
  fills.forEach((phrase, index) => {
    labels[labelForIndex(index)] = phrase.when;
  });
  labels.silent = silent;
  assertLabelCount(labels, estimator.limits);

  return {
    judge: (situation: WorkSpeechSituation, context) =>
      classifyJudge<WorkSpeechAnswer>({
        estimator,
        name: "work-speech",
        question,
        labels,
        situation,
        context,
        toAnswer: (label) => {
          if (label === "report") return { action: "report" };
          if (label === "silent") return { action: "silent" };
          const index = fills.findIndex(
            (_phrase, candidate) => labelForIndex(candidate) === label,
          );
          if (index === -1) return undefined;
          return { action: "fill", text: fills[index].text };
        },
      }),
  };
};
