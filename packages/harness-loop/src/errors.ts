export class StreamIncompleteError extends Error {
  override readonly name = "StreamIncompleteError";

  constructor() {
    super("Provider stream ended without a finish event");
  }
}
