export class EvalError extends Error {
  override readonly name: string = "EvalError";
}

export class NoRunInSessionError extends EvalError {
  override readonly name = "NoRunInSessionError";

  constructor(sessionId: string) {
    super(`No run found in session "${sessionId}"`);
  }
}

export class JevCheckError extends EvalError {
  override readonly name = "JevCheckError";
}
