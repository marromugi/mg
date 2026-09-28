import type { Message } from "@mg/core";
import { describe, expect, test } from "vitest";
import { transcribe } from "./transcript.js";

describe("transcribe", () => {
  test("lays out system, user and assistant text messages as bracketed role blocks separated by a blank line", () => {
    const entry: Message[] = [
      { role: "system", content: "I am Jev." },
      { role: "user", content: "alice: I got a dog" },
      { role: "assistant", parts: [{ type: "text", text: "Nice!" }] },
    ];

    expect(transcribe(entry)).toBe(
      "[system]\nI am Jev.\n\n[user]\nalice: I got a dog\n\n[assistant]\nNice!",
    );
  });

  test("lays out a reasoning part as a bracketed block, dropping the provider-specific carry", () => {
    const entry: Message[] = [
      {
        role: "assistant",
        parts: [
          {
            type: "reasoning",
            text: "she likes animals",
            carry: { provider: "openrouter", data: { x: 1 } },
          },
        ],
      },
    ];

    expect(transcribe(entry)).toBe("[reasoning]\nshe likes animals");
  });

  test("lays out a tool-call part with its id and name in the bracket and its arguments as JSON", () => {
    const entry: Message[] = [
      {
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            id: "c1",
            name: "note",
            arguments: { k: "v" },
          },
        ],
      },
    ];

    expect(transcribe(entry)).toBe('[tool-call c1 note]\n{"k":"v"}');
  });

  test("lays out a tool message with its call id in the bracket", () => {
    const entry: Message[] = [
      { role: "tool", toolCallId: "c1", content: "ok" },
    ];

    expect(transcribe(entry)).toBe("[tool-result c1]\nok");
  });

  test("puts a user message's author in the bracket as a JSON string, with the content on the next line", () => {
    const entry: Message[] = [
      { role: "user", author: "alice", content: "hi" },
    ];

    expect(transcribe(entry)).toBe('[user "alice"]\nhi');
  });

  test("escapes a quote in the author and keeps a space in it as is", () => {
    const withQuote: Message[] = [
      { role: "user", author: 'al"ice', content: "hi" },
    ];
    const withSpace: Message[] = [
      { role: "user", author: "alice smith", content: "hi" },
    ];

    expect(transcribe(withQuote)).toBe('[user "al\\"ice"]\nhi');
    expect(transcribe(withSpace)).toBe('[user "alice smith"]\nhi');
  });

  test("tags each user message with its own author across a longer conversation", () => {
    const entry: Message[] = [
      { role: "system", content: "s" },
      { role: "user", author: "alice", content: "hi" },
      { role: "assistant", parts: [{ type: "text", text: "hello" }] },
      { role: "user", author: "bob", content: "yo" },
    ];

    expect(transcribe(entry)).toBe(
      '[system]\ns\n\n[user "alice"]\nhi\n\n[assistant]\nhello\n\n' +
        '[user "bob"]\nyo',
    );
  });

  test("leaves a user message with no author as the plain [user] line", () => {
    const entry: Message[] = [{ role: "user", content: "hi" }];

    expect(transcribe(entry)).toBe("[user]\nhi");
  });

  test("throws a RangeError for a blank author", () => {
    const empty: Message[] = [
      { role: "user", author: "", content: "hi" },
    ];
    const whitespace: Message[] = [
      { role: "user", author: "  ", content: "hi" },
    ];

    expect(() => transcribe(empty)).toThrow(RangeError);
    expect(() => transcribe(empty)).toThrow(
      "user message author must not be blank",
    );
    expect(() => transcribe(whitespace)).toThrow(RangeError);
    expect(() => transcribe(whitespace)).toThrow(
      "user message author must not be blank",
    );
  });

  test("gives each part of an assistant message with several parts its own paragraph", () => {
    const entry: Message[] = [
      {
        role: "assistant",
        parts: [
          { type: "reasoning", text: "she likes animals" },
          {
            type: "tool-call",
            id: "c1",
            name: "note",
            arguments: { k: "v" },
          },
        ],
      },
      { role: "tool", toolCallId: "c1", content: "ok" },
      { role: "assistant", parts: [{ type: "text", text: "Nice!" }] },
    ];

    expect(transcribe(entry)).toBe(
      "[reasoning]\nshe likes animals\n\n[tool-call c1 note]\n" +
        '{"k":"v"}\n\n[tool-result c1]\nok\n\n[assistant]\nNice!',
    );
  });
});
