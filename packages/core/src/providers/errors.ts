import {
  ReasonError,
  type ReasonErrorOptions,
} from "../errors/index.js";

type ProviderRetryMark =
  | { retryable?: false; retryAfterMs?: never }
  | { retryable: true; retryAfterMs?: number };

export type ProviderErrorOptions = ReasonErrorOptions &
  ProviderRetryMark;

export abstract class ProviderBaseError extends ReasonError {
  abstract override readonly name: ProviderErrorName;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  protected constructor(
    message: string,
    options?: ProviderErrorOptions,
  ) {
    super(message, options);
    this.retryable = options?.retryable ?? false;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

// 応答が返らなかったときのエラーです。
export class ProviderRequestError extends ProviderBaseError {
  override readonly name = "ProviderRequestError";

  // protected な基底のコンストラクタを public にするために残しています。
  // oxlint-disable-next-line no-useless-constructor
  constructor(message: string, options?: ProviderErrorOptions) {
    super(message, options);
  }
}

// 応答は返ったが、使えないときのエラーです。再試行できません。
export class ProviderResponseError extends ProviderBaseError {
  override readonly name = "ProviderResponseError";

  // protected な基底のコンストラクタを public にし、再試行の印を外すために残しています。
  // oxlint-disable-next-line no-useless-constructor
  constructor(message: string, options?: ReasonErrorOptions) {
    super(message, options);
  }
}

export class ToolArgumentsError extends ProviderBaseError {
  override readonly name = "ToolArgumentsError";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly raw: string;

  constructor(
    toolCallId: string,
    toolName: string,
    raw: string,
    options?: { cause?: unknown },
  ) {
    super(
      `Failed to parse arguments for tool call ${toolCallId} (${toolName})`,
      // 引数はモデルの出力で、parse の失敗の文はそれを引きます。
      options?.cause === undefined
        ? options
        : { ...options, causeQuotesService: true },
    );
    this.toolCallId = toolCallId;
    this.toolName = toolName;
    this.raw = raw;
  }
}

export class ToolSchemaError extends ProviderBaseError {
  override readonly name = "ToolSchemaError";
  readonly toolName: string;

  constructor(toolName: string, options: { cause: unknown }) {
    super(`Failed to convert the schema for tool ${toolName}`, options);
    this.toolName = toolName;
  }
}

export class ProviderUnsupportedError extends ProviderBaseError {
  override readonly name = "ProviderUnsupportedError";
  readonly feature: string;

  constructor(message: string, feature: string) {
    super(message);
    this.feature = feature;
  }
}

export class ProviderRetryExhaustedError extends ProviderBaseError {
  override readonly name = "ProviderRetryExhaustedError";
  readonly attempts: number;

  constructor(attempts: number, options: { cause: unknown }) {
    super(`Provider retries exhausted (attempts: ${attempts})`, {
      cause: options.cause,
    });
    this.attempts = attempts;
  }
}

export type ProviderError =
  | ProviderRequestError
  | ProviderResponseError
  | ToolArgumentsError
  | ToolSchemaError
  | ProviderUnsupportedError
  | ProviderRetryExhaustedError;

export type ProviderErrorName = ProviderError["name"];

export const isProviderError = (
  error: unknown,
): error is ProviderError => error instanceof ProviderBaseError;
