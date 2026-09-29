// The time source the recorded listener and the recording player wait on.
// sleep rejects when the signal aborts.
export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
