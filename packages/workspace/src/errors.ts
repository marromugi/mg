export abstract class WorkspaceBaseError extends Error {
  abstract override readonly name: WorkspaceErrorName;

  protected constructor(
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export class ConnectorOpenError extends WorkspaceBaseError {
  override readonly name = "ConnectorOpenError";
  readonly kind: string;
  readonly index: number;

  constructor(
    kind: string,
    index: number,
    options: { cause: unknown },
  ) {
    super(
      `Failed to open connector "${kind}" at index ${index}`,
      options,
    );
    this.kind = kind;
    this.index = index;
  }
}

export class DuplicateToolNameError extends WorkspaceBaseError {
  override readonly name = "DuplicateToolNameError";
  readonly toolName: string;
  readonly kinds: readonly string[];

  constructor(toolName: string, kinds: readonly string[]) {
    super(
      `Duplicate tool name "${toolName}" from connectors: ${kinds.join(", ")}`,
    );
    this.toolName = toolName;
    this.kinds = kinds;
  }
}

export class WorkspaceCloseError extends WorkspaceBaseError {
  override readonly name = "WorkspaceCloseError";
  readonly errors: readonly unknown[];

  constructor(errors: readonly unknown[]) {
    super(`Failed to close ${errors.length} connection(s)`, {
      cause: errors[0],
    });
    this.errors = errors;
  }
}

export type WorkspaceError =
  ConnectorOpenError | DuplicateToolNameError | WorkspaceCloseError;

export type WorkspaceErrorName = WorkspaceError["name"];

export const isWorkspaceError = (
  error: unknown,
): error is WorkspaceError => error instanceof WorkspaceBaseError;
