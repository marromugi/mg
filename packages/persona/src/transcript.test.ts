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
