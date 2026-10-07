import type { Estimator } from "@mg/core";
import { createJevEstimator, createRetryingEstimator } from "@mg/core";

export const withSampleRetry = (
  estimator: Estimator,
  options?: {
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  },
): Estimator =>
  createRetryingEstimator({
    estimator,
    maxAttempts: 3,
    delaysMs: [1000, 2000],
    maxDelayMs: 10_000,
    ...(options?.sleep === undefined ? {} : { sleep: options.sleep }),
  });

// `inside` wraps the estimator that talks to the service, below the
// retries, so it sees each request on its own.
export const createSampleJevEstimator = (options: {
  apiKey: string;
  inside?: (estimator: Estimator) => Estimator;
}): Estimator =>
  withSampleRetry(
    (options.inside ?? ((estimator) => estimator))(
      createJevEstimator({ apiKey: options.apiKey }),
    ),
  );
