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

export const createSampleJevEstimator = (options: {
  apiKey: string;
}): Estimator =>
  withSampleRetry(createJevEstimator({ apiKey: options.apiKey }));
