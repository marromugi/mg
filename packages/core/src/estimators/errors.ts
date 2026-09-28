export type EstimatorRetryMark =
  | { retryable?: false; retryAfterMs?: never }
  | { retryable: true; retryAfterMs?: number };

export type EstimatorErrorOptions = {
  cause?: unknown;
} & EstimatorRetryMark;

export abstract class EstimatorBaseError extends Error {
  abstract override readonly name: EstimatorErrorName;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  protected constructor(
    message: string,
    options?: EstimatorErrorOptions,
  ) {
    super(message, options);
    this.retryable = options?.retryable === true;
    this.retryAfterMs = this.retryable
      ? options?.retryAfterMs
      : undefined;
  }
}

export class EstimatorHttpError extends EstimatorBaseError {
  override readonly name = "EstimatorHttpError";
  readonly status: number;
  readonly body: string;

  constructor(
    message: string,
    status: number,
    body: string,
    options?: EstimatorErrorOptions,
  ) {
    super(message, options);
    this.status = status;
    this.body = body;
  }
}

export class EstimatorTransportError extends EstimatorBaseError {
  override readonly name = "EstimatorTransportError";

  // cause を必須にするために残しています。
  // oxlint-disable-next-line no-useless-constructor
  constructor(
    message: string,
    options: EstimatorErrorOptions & { cause: unknown },
  ) {
    super(message, options);
  }
}

export class EstimatorResponseError extends EstimatorBaseError {
  override readonly name = "EstimatorResponseError";

  // protected な基底のコンストラクタを public にするために残しています。
  // oxlint-disable-next-line no-useless-constructor
  constructor(message: string, options?: EstimatorErrorOptions) {
    super(message, options);
  }
}

export class EstimatorRetryExhaustedError extends EstimatorBaseError {
  override readonly name = "EstimatorRetryExhaustedError";
  readonly attempts: number;

  constructor(attempts: number, options: { cause: unknown }) {
    super(`Estimator retries exhausted (attempts: ${attempts})`, {
      cause: options.cause,
    });
    this.attempts = attempts;
  }
}

export type EstimatorError =
  | EstimatorHttpError
  | EstimatorTransportError
  | EstimatorResponseError
  | EstimatorRetryExhaustedError;

export type EstimatorErrorName = EstimatorError["name"];

export const isEstimatorError = (
  error: unknown,
): error is EstimatorError => error instanceof EstimatorBaseError;
