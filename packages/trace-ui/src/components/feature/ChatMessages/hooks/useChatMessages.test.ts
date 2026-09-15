import { describe, expect, it } from "vitest";
import type { ChatMessagesResult } from "./useChatMessages.js";
import { useChatMessages } from "./useChatMessages.js";

const describeResult = (result: ChatMessagesResult): string => {
  switch (result.kind) {
    case "messages":
      return `messages:${result.messages.length}`;
    case "raw":
      return `raw:${result.raw}`;
    default: {
      const exhaustive: never = result;
      throw new Error(`unexpected kind: ${JSON.stringify(exhaustive)}`);
    }
  }
};

describe("useChatMessages", () => {
  it("parses an array of messages", () => {
    const raw = JSON.stringify([{ role: "user", content: "hi" }]);
    expect(useChatMessages(raw)).toEqual({
      kind: "messages",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("returns raw when the JSON is invalid", () => {
    expect(useChatMessages("{not json")).toEqual({
      kind: "raw",
      raw: "{not json",
    });
  });

  it("returns raw when an element is not a message", () => {
    const raw = JSON.stringify([{ role: "user" }, { content: 1 }]);
    expect(useChatMessages(raw)).toEqual({ kind: "raw", raw });
  });

  it("narrows the union on kind via an exhaustive switch", () => {
    const messagesRaw = JSON.stringify([
      { role: "user", content: "hi" },
    ]);
    expect(describeResult(useChatMessages(messagesRaw))).toBe(
      "messages:1",
    );
    expect(describeResult(useChatMessages("{not json"))).toBe(
      "raw:{not json",
    );
  });
});
