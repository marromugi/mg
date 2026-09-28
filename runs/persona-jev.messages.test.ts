import { describe, expect, test } from "vitest";
import { toMessages } from "./persona-jev.messages.ts";

describe("toMessages", () => {
  test("returns a user message with author user and the muttering wrapped around the input text", () => {
    const messages = toMessages({
      kind: "note",
      text: "今日はいい天気だな",
    });

    expect(messages).toEqual([
      {
        role: "user",
        author: "user",
        content:
          'The user just muttered to themselves: "今日はいい天気だな"',
      },
    ]);
  });
});
