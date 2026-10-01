export type TraceShutdownStep =
  "export" | "flush" | "shutdown" | "close";

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

export type TraceMissingSpan = {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
};

// Thrown, as one failure of closing, when spans had not ended by the time
// the record stopped taking spans. Those spans are not in the record.
export class TraceSpansNotEndedError extends Error {
  readonly spans: readonly TraceMissingSpan[];

  constructor(spans: readonly TraceMissingSpan[]) {
    const details = spans
      .map((span) => `${span.name} (span ${span.spanId})`)
      .join(", ");
    super(
      `${spans.length} span(s) had not ended when the record stopped taking spans, so they are not in the record: ${details}`,
    );
    this.name = "TraceSpansNotEndedError";
    this.spans = spans;
  }
}
