export class MemoryStoreClosedError extends Error {
  constructor() {
    super(
      "The memory store is closed. Open it again to keep using it.",
    );
    this.name = "MemoryStoreClosedError";
  }
}
