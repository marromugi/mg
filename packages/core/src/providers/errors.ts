export abstract class ProviderBaseError extends Error {
  abstract override readonly name: ProviderErrorName;

  protected constructor(
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
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
    options?: { cause?: unknown },
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
  constructor(message: string, options: { cause: unknown }) {
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

export type ProviderError =
  | ProviderHttpError
  | ProviderTransportError
  | ToolArgumentsError
  | ToolSchemaError;

export type ProviderErrorName = ProviderError["name"];

export const isProviderError = (
  error: unknown,
): error is ProviderError => error instanceof ProviderBaseError;
