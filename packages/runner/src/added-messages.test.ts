import type { Message } from "@mg/core";
import { describe, expect, test } from "vitest";
import { addedMessages } from "./added-messages.js";

const REPLY: Message = {
  role: "assistant",
  parts: [{ type: "text", text: "ok" }],
};

describe("addedMessages", () => {
  test("returns the messages after the given prefix when the result starts with it", () => {
    const given: Message[] = [{ role: "user", content: "hi" }];
    const result: Message[] = [{ role: "user", content: "hi" }, REPLY];

    expect(addedMessages(given, result)).toEqual({
      kind: "added",
      messages: [REPLY],
    });
  });

  test("returns no added messages when the result equals the given prefix exactly", () => {
    const given: Message[] = [{ role: "user", content: "hi" }];
    const result: Message[] = [{ role: "user", content: "hi" }];

    expect(addedMessages(given, result)).toEqual({
      kind: "added",
      messages: [],
    });
  });

  test("reports a diverged prefix when the result's head does not match the given messages", () => {
    const given: Message[] = [{ role: "user", content: "hi" }];
    const result: Message[] = [{ role: "user", content: "HI" }, REPLY];

    expect(addedMessages(given, result)).toEqual({ kind: "diverged" });
  });

  test("reports a diverged prefix when the result is shorter than the given messages", () => {
    const given: Message[] = [{ role: "user", content: "hi" }];
    const result: Message[] = [];

    expect(addedMessages(given, result)).toEqual({ kind: "diverged" });
  });
});
