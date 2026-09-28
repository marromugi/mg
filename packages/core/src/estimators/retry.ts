import {
  EstimatorRetryExhaustedError,
  isEstimatorError,
} from "./errors.js";
import type {
  ClassifyRequest,
  EstimateOptions,
  EstimateRequest,
  Estimator,
  ScoreRequest,
} from "./types.js";

export type RetryingEstimatorOptions = {
  estimator: Estimator;
  maxAttempts: number;
  delaysMs: readonly number[];
  maxDelayMs: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const defaultSleep = (
  ms: number,
  signal?: AbortSignal,
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason);
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort);
  });

const assertRetryingEstimatorOptions = (
  options: RetryingEstimatorOptions,
): void => {
  if (
    !Number.isInteger(options.maxAttempts) ||
    options.maxAttempts < 1
  ) {
    throw new RangeError(
      `maxAttempts must be an integer >= 1; got ${options.maxAttempts}`,
    );
  }

  const requiredDelays = options.maxAttempts - 1;

  if (options.delaysMs.length < requiredDelays) {
    throw new RangeError(
      `delaysMs must have at least ${requiredDelays} entries for maxAttempts ${options.maxAttempts}; got ${options.delaysMs.length}`,
    );
  }

  for (const delay of options.delaysMs) {
    if (!Number.isFinite(delay) || delay < 0) {
      throw new RangeError(
        `delaysMs entries must be finite and >= 0; got ${delay}`,
      );
    }
  }

  if (!Number.isFinite(options.maxDelayMs) || options.maxDelayMs < 0) {
    throw new RangeError(
      `maxDelayMs must be finite and >= 0; got ${options.maxDelayMs}`,
    );
  }
};

export const createRetryingEstimator = (
  options: RetryingEstimatorOptions,
): Estimator => {
  assertRetryingEstimatorOptions(options);

  const {
    estimator,
    maxAttempts,
    delaysMs,
    maxDelayMs,
    sleep = defaultSleep,
  } = options;

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

        if (attempts >= maxAttempts) {
          throw new EstimatorRetryExhaustedError(attempts, {
            cause: error,
          });
        }

        if (
          error.retryAfterMs !== undefined &&
          error.retryAfterMs > maxDelayMs
        ) {
          throw new EstimatorRetryExhaustedError(attempts, {
            cause: error,
          });
        }

        await sleep(
          error.retryAfterMs ?? delaysMs[attempts - 1],
          signal,
        );
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
