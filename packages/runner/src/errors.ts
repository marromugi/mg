export class InvalidRunConfigError extends Error {
  constructor(path: string, reason: string) {
    super(`${path}: ${reason}`);
    this.name = "InvalidRunConfigError";
  }
}

export class SubagentCloseError extends Error {
  readonly workspaceName: string;
  readonly answer: string;

  constructor(
    workspaceName: string,
    answer: string,
    options: { cause: unknown },
  ) {
    const causeMessage =
      options.cause instanceof Error
        ? options.cause.message
        : String(options.cause);
    super(
      `The subagent finished, but closing its workspace "${workspaceName}" failed: ${causeMessage}. Its answer follows:\n${answer}`,
      options,
    );
    this.name = "SubagentCloseError";
    this.workspaceName = workspaceName;
    this.answer = answer;
  }
}
