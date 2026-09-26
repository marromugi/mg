import type { Estimator } from "@mg/core";
import type {
  BackchannelAnswer,
  BackchannelJudge,
  BackchannelSituation,
} from "../types.js";
import {
  assertLabelCount,
  assertPhrasesUnique,
  assertQuestion,
  classifyJudge,
  type PhraseChoice,
} from "./classify.js";

export type EstimatorBackchannelJudgeOptions = {
  estimator: Estimator;
  question: string;
  phrases: readonly [PhraseChoice, ...PhraseChoice[]];
  none: string;
};

const labelForIndex = (index: number): string => `backchannel-${index}`;

export const createEstimatorBackchannelJudge = (
  options: EstimatorBackchannelJudgeOptions,
): BackchannelJudge => {
  const { estimator, question, phrases, none } = options;

  assertQuestion(question);
  assertPhrasesUnique(phrases);

  const labels: Record<string, string> = {};
  phrases.forEach((phrase, index) => {
    labels[labelForIndex(index)] = phrase.when;
  });
  labels.none = none;
  assertLabelCount(labels, estimator.limits);

  return {
    judge: (situation: BackchannelSituation, context) =>
      classifyJudge<BackchannelAnswer>({
        estimator,
        name: "backchannel",
        question,
        labels,
        situation,
        context,
        toAnswer: (label) => {
          if (label === "none") return { action: "none" };
          const index = phrases.findIndex(
            (_phrase, candidate) => labelForIndex(candidate) === label,
          );
          if (index === -1) return undefined;
          return { action: "backchannel", text: phrases[index].text };
        },
      }),
  };
};
