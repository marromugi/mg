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

export class ConnectorCloseError extends WorkspaceBaseError {
  override readonly name = "ConnectorCloseError";
  readonly kind: string;
  readonly errors: readonly unknown[];

  constructor(kind: string, errors: readonly unknown[]) {
    super(`Failed to close connector "${kind}"`, {
      cause: errors[0],
    });
    this.kind = kind;
    this.errors = errors;
  }
}

export class NothingListeningError extends WorkspaceBaseError {
  override readonly name = "NothingListeningError";
  readonly host: string;
  readonly port: number;
  readonly sshHost: string;

  constructor(
    host: string,
    port: number,
    sshHost: string,
    options: { cause: unknown },
  ) {
    super(
      `nothing is listening on ${host}:${port} on ${sshHost}`,
      options,
    );
    this.host = host;
    this.port = port;
    this.sshHost = sshHost;
  }
}

export type WorkspaceError =
  | ConnectorOpenError
  | ConnectorCloseError
  | DuplicateToolNameError
  | WorkspaceCloseError
  | NothingListeningError;

export type WorkspaceErrorName = WorkspaceError["name"];

export const isWorkspaceError = (
  error: unknown,
): error is WorkspaceError => error instanceof WorkspaceBaseError;
