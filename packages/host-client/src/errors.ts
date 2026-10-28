/** The host answered with a status that is not a success. */
export class HostRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`The host answered ${status}: ${message}`);
    this.name = "HostRequestError";
  }
}
