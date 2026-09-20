export abstract class EstimatorBaseError extends Error {
  abstract override readonly name: EstimatorErrorName;

  protected constructor(
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
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
    options?: { cause?: unknown },
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
  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
  }
}

export class EstimatorResponseError extends EstimatorBaseError {
  override readonly name = "EstimatorResponseError";

  // protected な基底のコンストラクタを public にするために残しています。
  // oxlint-disable-next-line no-useless-constructor
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export type EstimatorError =
  EstimatorHttpError | EstimatorTransportError | EstimatorResponseError;

export type EstimatorErrorName = EstimatorError["name"];

export const isEstimatorError = (
  error: unknown,
): error is EstimatorError => error instanceof EstimatorBaseError;
