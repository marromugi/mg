import { isEstimatorError, type Estimator } from "@mg/core";
import { ATTR, setSpanAttributes } from "@mg/trace";
import { TriggerError } from "../errors.js";
import { withTriggerSpan } from "../trace.js";
import type {
  Trigger,
  TriggerContext,
  TriggerDecision,
} from "../types.js";

export type TextTriggerInput = { kind: string; text: string };

export type EstimatorTriggerOptions = {
  estimator: Estimator;
  prompt: string;
  threshold?: number;
};

const DEFAULT_THRESHOLD = 0.7;
const QUESTION = "Should a run be started for this input?";

export const createEstimatorTrigger = (
  options: EstimatorTriggerOptions,
): Trigger<TextTriggerInput> => {
  const { estimator, prompt } = options;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  if (!(
    Number.isFinite(threshold) &&
    threshold >= 0 &&
    threshold <= 1
  )) {
    throw new RangeError("threshold must be between 0 and 1");
  }

  return {
    async decide(
      input: TextTriggerInput,
      context?: TriggerContext,
    ): Promise<TriggerDecision> {
      context?.signal?.throwIfAborted();

      return withTriggerSpan(
        context,
        { [ATTR.triggerModel]: estimator.model },
        async (span) => {
          let probability: number;
          try {
            ({ probability } = await estimator.estimate(
              {
                text: `Kind: ${input.kind}\n${input.text}`,
                question: `${prompt}\n\n${QUESTION}`,
              },
              { signal: context?.signal },
            ));
          } catch (error) {
            if (isEstimatorError(error)) {
              throw new TriggerError("Trigger judgement failed", {
                cause: error,
              });
            }
            throw error;
          }

          setSpanAttributes(span, {
            [ATTR.triggerProbability]: probability,
            [ATTR.triggerThreshold]: threshold,
          });

          const fired = probability >= threshold;
          const reason = fired
            ? `Probability ${probability} is at or above the threshold ${threshold}.`
            : `Probability ${probability} is below the threshold ${threshold}.`;

          return { fired, reason };
        },
      );
    },
  };
};
