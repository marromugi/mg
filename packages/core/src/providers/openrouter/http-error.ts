import { ProviderResponseError } from "../errors.js";

const BODY_LIMIT = 200;

// OpenRouter が返した status と本文を持つエラーです。
// message は本文の先頭 200 文字までです。
export class OpenRouterHttpError extends Error {
  override readonly name = "OpenRouterHttpError";
  readonly status: number;
  readonly body: string;

  constructor(
    status: number,
    body: string,
    options?: { cause?: unknown },
  ) {
    super(
      body.length > BODY_LIMIT
        ? `${body.slice(0, BODY_LIMIT)} (body cut at ${BODY_LIMIT} characters)`
        : body,
      options,
    );
    this.status = status;
    this.body = body;
  }
}

// 応答の本文か payload が使えないときのエラーです。
// 読み取った文を、status とともに OpenRouterHttpError に入れて cause にします。
export const unusableOpenRouterResponse = (
  message: string,
  status: number,
  text: string,
  cause?: unknown,
): ProviderResponseError =>
  new ProviderResponseError(message, {
    cause: new OpenRouterHttpError(
      status,
      text,
      cause === undefined ? undefined : { cause },
    ),
    causeQuotesService: true,
  });
