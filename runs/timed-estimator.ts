import type { Estimator } from "@mg/core";

export type TimedEstimator = Estimator & {
  // One entry per call to the wrapped estimator, failed calls included.
  readonly durationsMs: readonly number[];
};

export const createTimedEstimator = (
  estimator: Estimator,
  now: () => number = () => performance.now(),
): TimedEstimator => {
  const durationsMs: number[] = [];

  const timed =
    <TArgs extends unknown[], TResult>(
      call: (...args: TArgs) => Promise<TResult>,
    ) =>
    async (...args: TArgs): Promise<TResult> => {
      const start = now();
      try {
        return await call(...args);
      } finally {
        durationsMs.push(now() - start);
      }
    };

  return {
    model: estimator.model,
    limits: estimator.limits,
    estimate: timed((request, options) =>
      estimator.estimate(request, options),
    ),
    classify: timed((request, options) =>
      estimator.classify(request, options),
    ),
    score: timed((request, options) =>
      estimator.score(request, options),
    ),
    durationsMs,
  };
};

export const timingSummary = (
  durationsMs: readonly number[],
): { requests: number; medianMs: number; slowestMs: number } => {
  if (durationsMs.length === 0) {
    throw new Error("no request was timed");
  }
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    requests: sorted.length,
    medianMs: Math.round(median),
    slowestMs: Math.round(sorted[sorted.length - 1]),
  };
};
