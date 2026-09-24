export class RecallError extends Error {
  override readonly name: "RecallError";

  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
    this.name = "RecallError";
  }
}

export class ExtractorError extends Error {
  override readonly name: "ExtractorError";

  constructor(message: string, options: { cause: unknown }) {
    super(message, options);
    this.name = "ExtractorError";
  }
}

type ExtractorContractErrorKind =
  "unknown-counterpart" | "empty-text" | "duplicate-item";

export class ExtractorContractError extends Error {
  override readonly name = "ExtractorContractError";
  readonly kind: ExtractorContractErrorKind;
  readonly detail: string;

  constructor(kind: ExtractorContractErrorKind, detail: string) {
    super(detail);
    this.kind = kind;
    this.detail = detail;
  }
}
