import { MAX_JSON_DEPTH } from "./limits.js";

export class ConversationExistsError extends Error {
  override readonly name = "ConversationExistsError";
  readonly conversationId: string;

  constructor(conversationId: string) {
    super(`Conversation "${conversationId}" already exists.`);
    this.conversationId = conversationId;
  }
}

export class ConversationNotFoundError extends Error {
  override readonly name = "ConversationNotFoundError";
  readonly conversationId: string;

  constructor(conversationId: string) {
    super(
      `Conversation "${conversationId}" was not found. Create it before reading or appending.`,
    );
    this.conversationId = conversationId;
  }
}

export class ConversationRangeError extends Error {
  override readonly name = "ConversationRangeError";
  readonly count: number;

  constructor(count: number) {
    super(
      `The range count must be a positive integer, but got ${count}.`,
    );
    this.count = count;
  }
}

export class ConversationConflictError extends Error {
  override readonly name = "ConversationConflictError";
  readonly conversationId: string;
  readonly expectedLength: number;
  readonly actualLength: number;

  constructor(
    conversationId: string,
    expectedLength: number,
    actualLength: number,
  ) {
    super(
      `Conversation "${conversationId}" has ${actualLength} entries, but the append expected ${expectedLength}. Another append came first; nothing was written.`,
    );
    this.conversationId = conversationId;
    this.expectedLength = expectedLength;
    this.actualLength = actualLength;
  }
}

export class ConversationEntryUnreadableError extends Error {
  override readonly name = "ConversationEntryUnreadableError";
  readonly conversationId: string;
  readonly position: number;

  constructor(
    conversationId: string,
    position: number,
    cause: unknown,
  ) {
    super(
      `Conversation "${conversationId}" has a stored entry at position ${position} that cannot be read: ${
        cause instanceof Error ? cause.message : String(cause)
      }.`,
      { cause },
    );
    this.conversationId = conversationId;
    this.position = position;
  }
}

export class ConversationToolCallIdError extends Error {
  override readonly name = "ConversationToolCallIdError";
  readonly toolCallId: string;
  readonly position: number;

  constructor(toolCallId: string, position: number) {
    super(
      `Tool call id "${toolCallId}" is already stored at position ${position}. A tool-call id must be unique across the conversation.`,
    );
    this.toolCallId = toolCallId;
    this.position = position;
  }
}

export class EntryNotJsonError extends Error {
  override readonly name = "EntryNotJsonError";
  readonly kind: "not-json" | "cycle" | "too-deep";
  readonly path: string;

  constructor(kind: "not-json" | "cycle" | "too-deep", path: string) {
    super(
      kind === "not-json"
        ? `The entry holds a value at ${path} that does not survive a JSON round trip.`
        : kind === "cycle"
          ? `The entry holds a value at ${path} that refers back to one of the values containing it.`
          : `The entry nests a value at ${path} deeper than ${MAX_JSON_DEPTH} levels.`,
    );
    this.kind = kind;
    this.path = path;
  }
}

export class EntryToolPairingError extends Error {
  override readonly name = "EntryToolPairingError";
  readonly kind: "unanswered-call" | "orphan-result" | "duplicate-call";
  readonly toolCallId: string;

  constructor(
    kind: "unanswered-call" | "orphan-result" | "duplicate-call",
    toolCallId: string,
  ) {
    super(
      kind === "unanswered-call"
        ? `Tool call "${toolCallId}" has no tool result after it in the same entry.`
        : kind === "orphan-result"
          ? `Tool result "${toolCallId}" has no tool call before it in the same entry.`
          : `Tool call "${toolCallId}" appears more than once in the same entry.`,
    );
    this.kind = kind;
    this.toolCallId = toolCallId;
  }
}

export class ConversationStoreClosedError extends Error {
  override readonly name = "ConversationStoreClosedError";

  constructor() {
    super(
      "The conversation store is closed. Open it again to keep using it.",
    );
  }
}
