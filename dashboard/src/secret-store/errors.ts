// A failure of the store. The message never holds a secret's value.
export class SecretStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecretStoreError";
  }
}
