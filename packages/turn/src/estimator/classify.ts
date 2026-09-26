import type {
  Estimator,
  EstimatorLimits,
  EstimatorSubject,
} from "@mg/core";
import { isEstimatorError } from "@mg/core";
import type { TraceSpan } from "@mg/harness";
import { ATTR, jsonAttribute, setSpanAttributes } from "@mg/trace";
import { JudgeError } from "../errors.js";
import type { JudgeContext, JudgeName } from "../types.js";
import { withTurnSpan } from "../trace.js";

// a phrase a judge may answer with; `when` is the label description sent
// to the estimator
export type PhraseChoice = { text: string; when: string };

export const assertQuestion = (question: string): void => {
  if (question.trim() === "") {
    throw new RangeError("question must not be empty");
  }
};

export const assertPhrasesUnique = (
  phrases: readonly PhraseChoice[],
): void => {
  const seen = new Set<string>();
  for (const phrase of phrases) {
    if (seen.has(phrase.text)) {
      throw new RangeError(
        `phrase "${phrase.text}" is given more than once`,
      );
    }
    seen.add(phrase.text);
  }
};

export const assertLabelCount = (
  labels: Record<string, string>,
  limits: EstimatorLimits,
): void => {
  const count = Object.keys(labels).length;
  if (count > limits.maxLabels) {
    throw new RangeError(
      `${count} labels exceed the estimator limit of ${limits.maxLabels}`,
    );
  }
};

export type ClassifyJudgeOptions<TAnswer> = {
  estimator: Estimator;
  name: JudgeName;
  question: string;
  labels: Record<string, string>;
  situation: EstimatorSubject;
  context: JudgeContext | undefined;
  toAnswer: (label: string) => TAnswer | undefined;
};

// Sends the situation to the estimator as the classification subject,
// maps the chosen label to the caller's answer, and records the judge on
// a trace span. Every one of the six judges is built from this.
export const classifyJudge = async <TAnswer>(
  options: ClassifyJudgeOptions<TAnswer>,
): Promise<TAnswer> => {
  const {
    estimator,
    name,
    question,
    labels,
    situation,
    context,
    toAnswer,
  } = options;

  context?.signal?.throwIfAborted();

  return withTurnSpan(
    context,
    name,
    { [ATTR.turnModel]: estimator.model },
    async (span: TraceSpan) => {
      let label: string;
      let probabilities: Record<string, number>;
      try {
        ({ label, probabilities } = await estimator.classify(
          { subject: situation, question, labels },
          { signal: context?.signal },
        ));
      } catch (error) {
        if (isEstimatorError(error)) {
          throw new JudgeError(name, `Judgment "${name}" failed`, {
            cause: error,
          });
        }
        throw error;
      }

      const answer = toAnswer(label);
      if (answer === undefined) {
        throw new JudgeError(
          name,
          `Judgment "${name}" failed: the estimator chose "${label}", which is not one of its labels`,
        );
      }

      setSpanAttributes(span, {
        [ATTR.turnLabel]: label,
        [ATTR.turnProbabilities]: jsonAttribute(probabilities),
      });

      return answer;
    },
  );
};
