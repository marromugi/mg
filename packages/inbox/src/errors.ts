export class InboxClosedError extends Error {
  override readonly name = "InboxClosedError";

  constructor() {
    super("The inbox is closed. Create a new inbox to add input.");
  }
}

export class InboxStoreClosedError extends Error {
  override readonly name = "InboxStoreClosedError";

  constructor() {
    super("The inbox store is closed. Open it again to keep using it.");
  }
}

export class InboxItemUnreadableError extends Error {
  override readonly name = "InboxItemUnreadableError";
  readonly itemId: string;

  constructor(itemId: string, cause: unknown) {
    super(
      `Inbox item "${itemId}" has a stored input that cannot be read: ${
        cause instanceof Error ? cause.message : String(cause)
      }.`,
      { cause },
    );
    this.itemId = itemId;
  }
}

export class InboxInputNotJsonError extends Error {
  override readonly name = "InboxInputNotJsonError";

  constructor() {
    super("The input does not survive a JSON round trip.");
  }
}

export class InboxSettleError extends Error {
  override readonly name = "InboxSettleError";
  readonly itemId: string;
  readonly conversationId: string;

  constructor(itemId: string, conversationId: string, cause: unknown) {
    super(
      `Could not record the outcome of inbox item "${itemId}": ${
        cause instanceof Error ? cause.message : String(cause)
      }. Conversation "${conversationId}" stopped delivering; the item stays pending in the store.`,
      { cause },
    );
    this.itemId = itemId;
    this.conversationId = conversationId;
  }
}
