import type { JudgeName } from "./types.js";

export class JudgeError extends Error {
  override readonly name = "JudgeError";
  readonly judge: JudgeName;

  constructor(
    judge: JudgeName,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.judge = judge;
  }
}
