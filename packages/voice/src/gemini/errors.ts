export abstract class GeminiSpeechBaseError extends Error {
  abstract override readonly name: GeminiSpeechErrorName;

  protected constructor(
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export class GeminiSpeechHttpError extends GeminiSpeechBaseError {
  override readonly name = "GeminiSpeechHttpError";
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

export class GeminiSpeechTransportError extends GeminiSpeechBaseError {
  override readonly name = "GeminiSpeechTransportError";

  // cause を必須にするために残しています。
  // oxlint-disable-next-line no-useless-constructor
  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
  }
}

export class GeminiSpeechResponseError extends GeminiSpeechBaseError {
  override readonly name = "GeminiSpeechResponseError";

  // protected な基底のコンストラクタを public にするために残しています。
  // oxlint-disable-next-line no-useless-constructor
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export type GeminiSpeechError =
  | GeminiSpeechHttpError
  | GeminiSpeechTransportError
  | GeminiSpeechResponseError;

export type GeminiSpeechErrorName = GeminiSpeechError["name"];

export const isGeminiSpeechError = (
  error: unknown,
): error is GeminiSpeechError => error instanceof GeminiSpeechBaseError;
