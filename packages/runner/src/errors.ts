export class InvalidRunConfigError extends Error {
  constructor(path: string, reason: string) {
    super(`${path}: ${reason}`);
    this.name = "InvalidRunConfigError";
  }
}
