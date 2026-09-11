import type { StandardSchemaV1 } from "@standard-schema/spec";

export abstract class ToolRunBaseError extends Error {
  abstract override readonly name: ToolRunErrorName;
  readonly toolCallId: string;
  readonly toolName: string;

  protected constructor(message: string, toolCallId: string, toolName: string) {
    super(message);
    this.toolCallId = toolCallId;
    this.toolName = toolName;
  }
}

export class ToolNotFoundError extends ToolRunBaseError {
  override readonly name = "ToolNotFoundError";

  constructor(toolCallId: string, toolName: string) {
    super(`No tool named ${toolName} for tool call ${toolCallId}`, toolCallId, toolName);
  }
}

export class ToolInputError extends ToolRunBaseError {
  override readonly name = "ToolInputError";
  readonly issues: readonly StandardSchemaV1.Issue[];

  constructor(toolCallId: string, toolName: string, issues: readonly StandardSchemaV1.Issue[]) {
    super(`Invalid arguments for tool call ${toolCallId} (${toolName})`, toolCallId, toolName);
    this.issues = issues;
  }
}

export type ToolRunError = ToolNotFoundError | ToolInputError;

export type ToolRunErrorName = ToolRunError["name"];

export const isToolRunError = (error: unknown): error is ToolRunError =>
  error instanceof ToolRunBaseError;
