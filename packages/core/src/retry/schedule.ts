export type RetrySchedule = {
  maxAttempts: number;
  delaysMs: readonly number[];
  maxDelayMs: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export type RetryStep = { wait: number } | { exhausted: true };

export const defaultSleep = (
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

export const assertRetrySchedule = (schedule: RetrySchedule): void => {
  if (
    !Number.isInteger(schedule.maxAttempts) ||
    schedule.maxAttempts < 1
  ) {
    throw new RangeError(
      `maxAttempts must be an integer >= 1; got ${schedule.maxAttempts}`,
    );
  }

  const requiredDelays = schedule.maxAttempts - 1;

  if (schedule.delaysMs.length < requiredDelays) {
    throw new RangeError(
      `delaysMs must have at least ${requiredDelays} entries for maxAttempts ${schedule.maxAttempts}; got ${schedule.delaysMs.length}`,
    );
  }

  for (const delay of schedule.delaysMs) {
    if (!Number.isFinite(delay) || delay < 0) {
      throw new RangeError(
        `delaysMs entries must be finite and >= 0; got ${delay}`,
      );
    }
  }

  if (
    !Number.isFinite(schedule.maxDelayMs) ||
    schedule.maxDelayMs < 0
  ) {
    throw new RangeError(
      `maxDelayMs must be finite and >= 0; got ${schedule.maxDelayMs}`,
    );
  }
};

export const nextRetryStep = (
  schedule: RetrySchedule,
  attempts: number,
  retryAfterMs: number | undefined,
): RetryStep => {
  if (attempts >= schedule.maxAttempts) return { exhausted: true };

  if (
    retryAfterMs !== undefined &&
    retryAfterMs > schedule.maxDelayMs
  ) {
    return { exhausted: true };
  }

  return { wait: retryAfterMs ?? schedule.delaysMs[attempts - 1] };
};
