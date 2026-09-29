export class TalkerError extends Error {
  override readonly name = "TalkerError";
  readonly reason: string;

  constructor(reason: string, options?: { cause?: unknown }) {
    super(reason, options);
    this.reason = reason;
  }
}
