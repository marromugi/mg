export class NameTakenError extends Error {
  override readonly name = "NameTakenError";

  constructor(readonly definitionName: string) {
    super(`Another harness is already named ${definitionName}`);
  }
}
