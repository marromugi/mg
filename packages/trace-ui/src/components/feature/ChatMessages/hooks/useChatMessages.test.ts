import { describe, expect, it } from "vitest";
import { useChatMessages } from "./useChatMessages.js";

describe("useChatMessages", () => {
  it("parses an array of messages", () => {
    const raw = JSON.stringify([{ role: "user", content: "hi" }]);
    expect(useChatMessages(raw)).toEqual({
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("returns raw when the JSON is invalid", () => {
    expect(useChatMessages("{not json")).toEqual({ raw: "{not json" });
  });

  it("returns raw when an element is not a message", () => {
    const raw = JSON.stringify([{ role: "user" }, { content: 1 }]);
    expect(useChatMessages(raw)).toEqual({ raw });
  });
});
