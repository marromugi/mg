export type TraceShutdownStep = "flush" | "shutdown" | "close";

export type TraceShutdownFailure = {
  readonly target: string;
  readonly step: TraceShutdownStep;
  readonly error: unknown;
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const describeFailure = (failure: TraceShutdownFailure): string =>
  `${failure.target} (${failure.step}): ${describeError(failure.error)}`;

const buildMessage = (
  failures: readonly TraceShutdownFailure[],
): string => {
  const noun = failures.length === 1 ? "target" : "targets";
  const details = failures.map(describeFailure).join("; ");
  return `Closing the trace record failed for ${failures.length} ${noun}: ${details}`;
};

// Thrown when closing a trace record fails. Each failure names the target
// that failed, the closing step it failed at, and the value it threw.
export class TraceShutdownError extends AggregateError {
  readonly failures: readonly TraceShutdownFailure[];

  constructor(failures: readonly TraceShutdownFailure[]) {
    super(
      failures.map((failure) => failure.error),
      buildMessage(failures),
    );
    this.name = "TraceShutdownError";
    this.failures = failures;
  }
}
