import { isEstimatorError, type Estimator } from "@mg/core";
import { EstimatorCheckError } from "./errors.js";
import { transcribe } from "./transcript.js";
import type {
  Check,
  CheckOutcome,
  EvalContext,
  EvalInput,
} from "./types.js";
import type { RunView } from "./view.js";

export type EstimatorCheckerOptions = {
  estimator: Estimator;
  transcribe?: (view: RunView) => string;
};

export type EstimatorCheckOptions = {
  name: string;
  question: string;
  threshold?: number;
};

export type EstimatorChecker = (
  options: EstimatorCheckOptions,
) => Check;

const DEFAULT_THRESHOLD = 0.9;

const isValidThreshold = (threshold: number): boolean =>
  Number.isFinite(threshold) && threshold >= 0 && threshold <= 1;

export const createEstimatorChecker = (
  options: EstimatorCheckerOptions,
): EstimatorChecker => {
  const { estimator } = options;
  const toText = options.transcribe ?? transcribe;

  return (checkOptions: EstimatorCheckOptions): Check => {
    const { name, question } = checkOptions;
    const threshold = checkOptions.threshold ?? DEFAULT_THRESHOLD;

    if (name === "") {
      throw new RangeError("check name must not be empty");
    }
    if (question === "") {
      throw new RangeError("question must not be empty");
    }
    if (!isValidThreshold(threshold)) {
      throw new RangeError("threshold must be between 0 and 1");
    }

    return {
      name,
      async evaluate(
        input: EvalInput,
        context?: EvalContext,
      ): Promise<CheckOutcome> {
        context?.signal?.throwIfAborted();

        let probability: number;
        try {
          ({ probability } = await estimator.estimate(
            { text: toText(input.view), question },
            { signal: context?.signal },
          ));
        } catch (error) {
          if (isEstimatorError(error)) {
            throw new EstimatorCheckError("Estimator request failed", {
              cause: error,
            });
          }
          throw error;
        }

        const passed = probability >= threshold;

        return {
          passed,
          score: probability,
          threshold,
          reason: `Estimator answered ${probability.toFixed(
            3,
          )}; threshold ${threshold}`,
        };
      },
    };
  };
};
