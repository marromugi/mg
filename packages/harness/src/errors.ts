export class HarnessIncompleteError extends Error {
  override readonly name = "HarnessIncompleteError";

  constructor() {
    super("Harness event stream ended without a done event");
  }
}
