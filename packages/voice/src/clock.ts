// The time source the recorded listener and the recording player wait on.
// sleep rejects when the signal aborts.
export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

// Sleeps on the clock; false when the signal fired before or during
// the wait. A sleep failure while the signal has not fired is thrown.
export const sleepUnlessAborted = async (
  clock: Clock,
  ms: number,
  signal: AbortSignal,
): Promise<boolean> => {
  if (signal.aborted) return false;
  try {
    await clock.sleep(ms, signal);
  } catch (error) {
    if (signal.aborted) return false;
    throw error;
  }
  return !signal.aborted;
};
