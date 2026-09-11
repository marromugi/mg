export class ProviderError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.body = body;
  }
}

export class ToolArgumentsError extends Error {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly raw: string;

  constructor(toolCallId: string, toolName: string, raw: string) {
    super(`Failed to parse arguments for tool call ${toolCallId} (${toolName})`);
    this.name = "ToolArgumentsError";
    this.toolCallId = toolCallId;
    this.toolName = toolName;
    this.raw = raw;
  }
}
