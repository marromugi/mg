export class StreamIncompleteError extends Error {
  override readonly name = "StreamIncompleteError";

  constructor() {
    super("Provider stream ended without a finish event");
  }
}

export class DuplicateCallableNameError extends Error {
  override readonly name = "DuplicateCallableNameError";

  constructor(name: string) {
    super(`Name "${name}" is used by more than one tool or subagent`);
  }
}
