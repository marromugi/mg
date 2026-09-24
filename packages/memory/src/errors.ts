export class PersonaExistsError extends Error {
  override readonly name = "PersonaExistsError";
  readonly personaId: string;

  constructor(personaId: string) {
    super(`Persona "${personaId}" already exists.`);
    this.personaId = personaId;
  }
}

export class PersonaNotFoundError extends Error {
  override readonly name = "PersonaNotFoundError";
  readonly personaId: string;

  constructor(personaId: string) {
    super(
      `Persona "${personaId}" was not found. Create it before reading, writing, or deleting.`,
    );
    this.personaId = personaId;
  }
}

export type MemoryConflictMismatch = {
  kind: "persona" | "summary";
  key?: string;
  expectedVersion: number;
  actualVersion: number;
};

export class MemoryConflictError extends Error {
  override readonly name = "MemoryConflictError";
  readonly personaId: string;
  readonly mismatches: readonly MemoryConflictMismatch[];

  constructor(
    personaId: string,
    mismatches: readonly MemoryConflictMismatch[],
  ) {
    super(
      `Persona "${personaId}" has a version mismatch on ${mismatches
        .map((m) =>
          m.key === undefined ? m.kind : `${m.kind} "${m.key}"`,
        )
        .join(", ")}. Nothing was written.`,
    );
    this.personaId = personaId;
    this.mismatches = mismatches;
  }
}

export class MemoryItemExistsError extends Error {
  override readonly name = "MemoryItemExistsError";
  readonly personaId: string;
  readonly itemIds: readonly string[];

  constructor(personaId: string, itemIds: readonly string[]) {
    super(
      `Persona "${personaId}" already has items ${itemIds.join(", ")}. Nothing was written.`,
    );
    this.personaId = personaId;
    this.itemIds = itemIds;
  }
}

export class MemoryItemNotFoundError extends Error {
  override readonly name = "MemoryItemNotFoundError";
  readonly personaId: string;
  readonly itemIds: readonly string[];

  constructor(personaId: string, itemIds: readonly string[]) {
    super(
      `Persona "${personaId}" has no items ${itemIds.join(", ")}. Nothing was written.`,
    );
    this.personaId = personaId;
    this.itemIds = itemIds;
  }
}

export class MemoryArgumentError extends Error {
  override readonly name = "MemoryArgumentError";
  readonly kind:
    | "empty-id"
    | "empty-text"
    | "duplicate-id"
    | "hit-and-miss"
    | "empty-change"
    | "invalid-version"
    | "invalid-time"
    | "empty-list";
  readonly detail: string;

  constructor(
    kind:
      | "empty-id"
      | "empty-text"
      | "duplicate-id"
      | "hit-and-miss"
      | "empty-change"
      | "invalid-version"
      | "invalid-time"
      | "empty-list",
    detail: string,
  ) {
    super(detail);
    this.kind = kind;
    this.detail = detail;
  }
}
