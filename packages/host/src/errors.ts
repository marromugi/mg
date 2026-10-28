export class ReplyLogClosedError extends Error {
  override readonly name = "ReplyLogClosedError";

  constructor() {
    super("The reply log is closed. Open it again to keep using it.");
  }
}

export class DuplicateClientTokenError extends Error {
  override readonly name = "DuplicateClientTokenError";

  constructor(first: string, second: string) {
    super(
      `Clients "${first}" and "${second}" have the same token. Give each client its own token.`,
    );
  }
}

export class EmptyClientTokenError extends Error {
  override readonly name = "EmptyClientTokenError";

  constructor(name: string) {
    super(`Client "${name}" has an empty token. Give it a token.`);
  }
}
