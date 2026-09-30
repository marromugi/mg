export type GateErrorOptions = {
  cause?: unknown;
  // 制限された呼び出し側に見せる文です。省略すると message と同じです。
  callerMessage?: string;
};

export class GateError extends Error {
  override readonly name = "GateError";
  readonly callerMessage: string;

  constructor(message: string, options?: GateErrorOptions) {
    super(
      message,
      options !== undefined && "cause" in options
        ? { cause: options.cause }
        : undefined,
    );
    this.callerMessage = options?.callerMessage ?? message;
  }
}
