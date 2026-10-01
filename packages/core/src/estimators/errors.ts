import {
  ReasonError,
  SERVICE_TEXT_LEFT_OUT,
  type ReasonErrorOptions,
} from "../errors/index.js";

type EstimatorRetryMark =
  | { retryable?: false; retryAfterMs?: never }
  | { retryable: true; retryAfterMs?: number };

export { SERVICE_TEXT_LEFT_OUT };

export type EstimatorErrorOptions = ReasonErrorOptions &
  EstimatorRetryMark;

export abstract class EstimatorBaseError extends ReasonError {
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

export class EstimatorRequestError extends EstimatorBaseError {
  override readonly name = "EstimatorRequestError";

  // protected な基底のコンストラクタを public にするために残しています。
  // oxlint-disable-next-line no-useless-constructor
  constructor(message: string, options?: EstimatorErrorOptions) {
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
  | EstimatorRequestError
  | EstimatorResponseError
  | EstimatorRetryExhaustedError;

export type EstimatorErrorName = EstimatorError["name"];

export const isEstimatorError = (
  error: unknown,
): error is EstimatorError => error instanceof EstimatorBaseError;
