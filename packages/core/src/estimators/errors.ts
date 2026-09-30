type EstimatorRetryMark =
  | { retryable?: false; retryAfterMs?: never }
  | { retryable: true; retryAfterMs?: number };

// 実装が本文の文を印付けする 2 つの方法です。
// withoutServiceText は本文の文を伏せた自分の文で、
// causeQuotesService は cause の文が本文を引いていることを示します。
type EstimatorServiceTextMark = {
  withoutServiceText?: string;
  causeQuotesService?: true;
};

export type EstimatorErrorOptions = {
  cause?: unknown;
} & EstimatorRetryMark &
  EstimatorServiceTextMark;

export const SERVICE_TEXT_LEFT_OUT = "(text from the service left out)";

const NON_ERROR_CAUSE = "(non-Error cause)";

// cause の連鎖を下って、理由の文を集めます。
// textOf は連鎖の中の Error から、集める文を選びます。
const causeTexts = (
  cause: unknown,
  textOf: (error: Error) => string,
): string[] => {
  const texts: string[] = [];
  const seen = new Set<unknown>();
  let current = cause;
  while (current !== undefined) {
    if (typeof current === "string") {
      if (current !== "") texts.push(current);
      break;
    }
    if (!(current instanceof Error)) {
      texts.push(NON_ERROR_CAUSE);
      break;
    }
    if (seen.has(current)) break;
    seen.add(current);
    const text = textOf(current);
    if (text !== "") texts.push(text);
    if (current instanceof EstimatorBaseError) break;
    current = current.cause;
  }
  return texts;
};

export abstract class EstimatorBaseError extends Error {
  abstract override readonly name: EstimatorErrorName;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly messageWithoutServiceText: string;

  protected constructor(
    message: string,
    options?: EstimatorErrorOptions,
  ) {
    super(
      [
        message,
        ...causeTexts(options?.cause, (error) => error.message),
      ].join(": "),
      options,
    );
    const start = options?.withoutServiceText ?? message;
    this.messageWithoutServiceText =
      options?.causeQuotesService === true
        ? `${start}: ${SERVICE_TEXT_LEFT_OUT}`
        : [
            start,
            ...causeTexts(options?.cause, (error) =>
              error instanceof EstimatorBaseError
                ? error.messageWithoutServiceText
                : error.message,
            ),
          ].join(": ");
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
