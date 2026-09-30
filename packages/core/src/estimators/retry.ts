import {
  EstimatorRetryExhaustedError,
  isEstimatorError,
} from "./errors.js";
import {
  assertRetrySchedule,
  defaultSleep,
  nextRetryStep,
} from "../retry/index.js";
import type { RetrySchedule } from "../retry/index.js";
import type {
  ClassifyRequest,
  EstimateOptions,
  EstimateRequest,
  Estimator,
  ScoreRequest,
} from "./types.js";

export type RetryingEstimatorOptions = {
  estimator: Estimator;
} & RetrySchedule;

export const createRetryingEstimator = (
  options: RetryingEstimatorOptions,
): Estimator => {
  assertRetrySchedule(options);

  const { estimator, sleep = defaultSleep } = options;

  const run = async <T>(
    operation: () => Promise<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> => {
    let attempts = 0;

    for (;;) {
      attempts++;

      try {
        return await operation();
      } catch (error) {
        if (!isEstimatorError(error) || !error.retryable) {
          throw error;
        }

        const step = nextRetryStep(
          options,
          attempts,
          error.retryAfterMs,
        );

        if ("exhausted" in step) {
          throw new EstimatorRetryExhaustedError(attempts, {
            cause: error,
          });
        }

        await sleep(step.wait, signal);
        signal?.throwIfAborted();
      }
    }
  };

  return {
    model: estimator.model,
    limits: estimator.limits,
    estimate: (
      request: EstimateRequest,
      callOptions?: EstimateOptions,
    ) =>
      run(
        () =>
          estimator.estimate(request, { signal: callOptions?.signal }),
        callOptions?.signal,
      ),
    classify: (
      request: ClassifyRequest,
      callOptions?: EstimateOptions,
    ) =>
      run(
        () =>
          estimator.classify(request, { signal: callOptions?.signal }),
        callOptions?.signal,
      ),
    score: (request: ScoreRequest, callOptions?: EstimateOptions) =>
      run(
        () => estimator.score(request, { signal: callOptions?.signal }),
        callOptions?.signal,
      ),
  };
};
