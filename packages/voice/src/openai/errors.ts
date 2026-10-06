export abstract class OpenAiSpeechBaseError extends Error {
  abstract override readonly name: OpenAiSpeechErrorName;

  protected constructor(
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export class OpenAiSpeechHttpError extends OpenAiSpeechBaseError {
  override readonly name = "OpenAiSpeechHttpError";
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

export class OpenAiSpeechTransportError extends OpenAiSpeechBaseError {
  override readonly name = "OpenAiSpeechTransportError";

  // cause を必須にするために残しています。
  // oxlint-disable-next-line no-useless-constructor
  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
  }
}

export class OpenAiSpeechResponseError extends OpenAiSpeechBaseError {
  override readonly name = "OpenAiSpeechResponseError";

  // protected な基底のコンストラクタを public にするために残しています。
  // oxlint-disable-next-line no-useless-constructor
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export type OpenAiSpeechError =
  | OpenAiSpeechHttpError
  | OpenAiSpeechTransportError
  | OpenAiSpeechResponseError;

export type OpenAiSpeechErrorName = OpenAiSpeechError["name"];

export const isOpenAiSpeechError = (
  error: unknown,
): error is OpenAiSpeechError => error instanceof OpenAiSpeechBaseError;
