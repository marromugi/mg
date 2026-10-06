// A failure of the store. The message never holds a secret's value.
export class SecretStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecretStoreError";
  }
}

// A value the store cannot write whole. Nothing was written.
export class SecretTooLongError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`The value is longer than ${maxBytes} bytes`);
    this.name = "SecretTooLongError";
    this.maxBytes = maxBytes;
  }
}
