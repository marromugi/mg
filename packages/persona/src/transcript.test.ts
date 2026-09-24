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
});
