import { describe, expect, it } from "vitest";
import { ATTR } from "../../../../vocabulary.js";
import { newShapeLlmNode } from "../../../../stories/fixtures.js";
import type { ChatMessagesResult } from "./useChatMessages.js";
import {
  normaliseChatMessage,
  useChatMessages,
} from "./useChatMessages.js";

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

  it("normalises a new-shape assistant message into the view model", () => {
    const raw = newShapeLlmNode.attributes[
      ATTR.llmOutputMessages
    ] as string;

    expect(useChatMessages(raw)).toEqual({
      kind: "messages",
      messages: [
        {
          role: "assistant",
          content: "It should be sunny.",
          toolCalls: [
            {
              id: "call-1",
              name: "web-search",
              arguments: { query: "weather" },
            },
          ],
          reasoning: "checking the forecast",
        },
      ],
    });
  });
});

describe("normaliseChatMessage", () => {
  it("normalises a new-shape message, joining text and reasoning parts", () => {
    const message = {
      role: "assistant",
      parts: [
        { type: "reasoning", text: "first" },
        { type: "reasoning", text: "second" },
        { type: "text", text: "hello " },
        { type: "text", text: "world" },
        {
          type: "tool-call",
          id: "call-1",
          name: "web-search",
          arguments: { query: "weather" },
        },
      ],
    };

    expect(normaliseChatMessage(message)).toEqual({
      role: "assistant",
      content: "hello world",
      toolCalls: [
        {
          id: "call-1",
          name: "web-search",
          arguments: { query: "weather" },
        },
      ],
      reasoning: "first\nsecond",
    });
  });

  it("omits toolCalls and reasoning when the new shape has none", () => {
    const message = {
      role: "assistant",
      parts: [{ type: "text", text: "hi" }],
    };

    expect(normaliseChatMessage(message)).toEqual({
      role: "assistant",
      content: "hi",
    });
  });

  it("returns undefined when no parts entry is readable", () => {
    const message = {
      role: "assistant",
      parts: [
        { type: "image", url: "http://example.com/x.png" },
        { type: "tool-call", id: "call-1", arguments: {} },
        "not-an-object",
      ],
    };

    expect(normaliseChatMessage(message)).toBeUndefined();
  });

  it("keeps a reasoning-only message readable", () => {
    const message = {
      role: "assistant",
      parts: [{ type: "reasoning", text: "thinking" }],
    };

    expect(normaliseChatMessage(message)).toEqual({
      role: "assistant",
      content: "",
      reasoning: "thinking",
    });
  });

  it("keeps a message with an empty parts array readable", () => {
    const message = { role: "assistant", parts: [] };

    expect(normaliseChatMessage(message)).toEqual({
      role: "assistant",
      content: "",
    });
  });

  it("keeps the parts recognised in a mixed array", () => {
    const message = {
      role: "assistant",
      parts: [
        { type: "image", url: "http://example.com/x.png" },
        { type: "text", text: "hi" },
        { type: "reasoning", text: "thinking" },
      ],
    };

    expect(normaliseChatMessage(message)).toEqual({
      role: "assistant",
      content: "hi",
      reasoning: "thinking",
    });
  });

  it("skips a parts entry that is not an object", () => {
    const message = {
      role: "assistant",
      parts: ["not-an-object", { type: "text", text: "hi" }],
    };

    expect(normaliseChatMessage(message)).toEqual({
      role: "assistant",
      content: "hi",
    });
  });

  it("skips a parts entry with an unknown type", () => {
    const message = {
      role: "assistant",
      parts: [
        { type: "image", url: "http://example.com/x.png" },
        { type: "text", text: "hi" },
      ],
    };

    expect(normaliseChatMessage(message)).toEqual({
      role: "assistant",
      content: "hi",
    });
  });

  it("skips a tool-call part missing its name", () => {
    const message = {
      role: "assistant",
      parts: [
        { type: "tool-call", id: "call-1", arguments: {} },
        { type: "text", text: "hi" },
      ],
    };

    expect(normaliseChatMessage(message)).toEqual({
      role: "assistant",
      content: "hi",
    });
  });

  it("passes an old-shape message through unchanged", () => {
    const message = {
      role: "assistant",
      content: "hi",
      toolCalls: [{ id: "call-1", name: "web-search", arguments: {} }],
    };

    expect(normaliseChatMessage(message)).toEqual(message);
  });

  it("returns undefined for a value with no role", () => {
    expect(normaliseChatMessage({ content: "hi" })).toBeUndefined();
  });

  it("returns undefined for a non-object value", () => {
    expect(normaliseChatMessage("not-a-message")).toBeUndefined();
    expect(normaliseChatMessage(null)).toBeUndefined();
  });
});
