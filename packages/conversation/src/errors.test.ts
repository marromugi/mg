import { describe, expect, test } from "vitest";
import {
  ConversationConflictError,
  ConversationExistsError,
  ConversationNotFoundError,
  ConversationRangeError,
  EntryNotJsonError,
  EntryToolPairingError,
} from "./errors.js";

describe("ConversationExistsError", () => {
  test("names the conversation that already exists", () => {
    const error = new ConversationExistsError("jev");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ConversationExistsError");
    expect(error.conversationId).toBe("jev");
    expect(error.message).toBe('Conversation "jev" already exists.');
  });
});

describe("ConversationNotFoundError", () => {
  test("names the conversation and how to fix it", () => {
    const error = new ConversationNotFoundError("jev");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ConversationNotFoundError");
    expect(error.conversationId).toBe("jev");
    expect(error.message).toBe(
      'Conversation "jev" was not found. Create it before reading or appending.',
    );
  });
});

describe("ConversationRangeError", () => {
  test("names the count that was not a positive integer", () => {
    const error = new ConversationRangeError(0);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ConversationRangeError");
    expect(error.count).toBe(0);
    expect(error.message).toBe(
      "The range count must be a positive integer, but got 0.",
    );
  });
});

describe("ConversationConflictError", () => {
  test("names the conversation and both entry counts", () => {
    const error = new ConversationConflictError("jev", 2, 3);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ConversationConflictError");
    expect(error.conversationId).toBe("jev");
    expect(error.expectedLength).toBe(2);
    expect(error.actualLength).toBe(3);
    expect(error.message).toBe(
      'Conversation "jev" has 3 entries, but the append expected 2. Another append came first; nothing was written.',
    );
  });
});

describe("EntryNotJsonError", () => {
  test("names the path of the offending value", () => {
    const error = new EntryNotJsonError(
      "messages[1].parts[0].arguments.at",
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("EntryNotJsonError");
    expect(error.path).toBe("messages[1].parts[0].arguments.at");
    expect(error.message).toBe(
      "The entry holds a value at messages[1].parts[0].arguments.at that does not survive a JSON round trip.",
    );
  });
});

describe("EntryToolPairingError", () => {
  test("names the tool call that has no result after it", () => {
    const error = new EntryToolPairingError("unanswered-call", "c1");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("EntryToolPairingError");
    expect(error.kind).toBe("unanswered-call");
    expect(error.toolCallId).toBe("c1");
    expect(error.message).toBe(
      'Tool call "c1" has no tool result after it in the same entry.',
    );
  });

  test("names the tool result that has no call before it", () => {
    const error = new EntryToolPairingError("orphan-result", "c1");

    expect(error.kind).toBe("orphan-result");
    expect(error.message).toBe(
      'Tool result "c1" has no tool call before it in the same entry.',
    );
  });
});
