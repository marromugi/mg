export abstract class GeminiTranscriptionBaseError extends Error {
  abstract override readonly name: GeminiTranscriptionErrorName;

  protected constructor(
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export class GeminiTranscriptionTransportError extends GeminiTranscriptionBaseError {
  override readonly name = "GeminiTranscriptionTransportError";
  readonly code: number | undefined;
  readonly reason: string | undefined;

  constructor(
    message: string,
    details: { code?: number; reason?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: details.cause });
    this.code = details.code;
    this.reason = details.reason;
  }
}

export class GeminiTranscriptionResponseError extends GeminiTranscriptionBaseError {
  override readonly name = "GeminiTranscriptionResponseError";

  // protected な基底のコンストラクタを public にするために残しています。
  // oxlint-disable-next-line no-useless-constructor
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export type GeminiTranscriptionError =
  GeminiTranscriptionTransportError | GeminiTranscriptionResponseError;

export type GeminiTranscriptionErrorName =
  GeminiTranscriptionError["name"];

export const isGeminiTranscriptionError = (
  error: unknown,
): error is GeminiTranscriptionError =>
  error instanceof GeminiTranscriptionBaseError;
