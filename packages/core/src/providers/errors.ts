type ProviderRetryMark =
  | { retryable?: false; retryAfterMs?: never }
  | { retryable: true; retryAfterMs?: number };

export type ProviderErrorOptions = {
  cause?: unknown;
} & ProviderRetryMark;

export abstract class ProviderBaseError extends Error {
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

export class ProviderHttpError extends ProviderBaseError {
  override readonly name = "ProviderHttpError";
  readonly status: number;
  readonly body: string;

  constructor(
    message: string,
    status: number,
    body: string,
    options?: ProviderErrorOptions,
  ) {
    super(message, options);
    this.status = status;
    this.body = body;
  }
}

export class ProviderTransportError extends ProviderBaseError {
  override readonly name = "ProviderTransportError";

  // cause を必須にするために残しています。
  // oxlint-disable-next-line no-useless-constructor
  constructor(
    message: string,
    options: ProviderErrorOptions & { cause: unknown },
  ) {
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
      options,
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
  | ProviderHttpError
  | ProviderTransportError
  | ToolArgumentsError
  | ToolSchemaError
  | ProviderUnsupportedError
  | ProviderRetryExhaustedError;

export type ProviderErrorName = ProviderError["name"];

export const isProviderError = (
  error: unknown,
): error is ProviderError => error instanceof ProviderBaseError;
