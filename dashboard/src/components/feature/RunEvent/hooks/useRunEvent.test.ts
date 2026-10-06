import { describe, expect, it } from "vitest";
import { useRunEvent } from "./useRunEvent.js";

describe("useRunEvent", () => {
  it("shows assistant text as it is", () => {
    expect(
      useRunEvent({
        type: "harness",
        event: { type: "text-delta", delta: "po" },
      }),
    ).toEqual({ kind: "text", text: "po" });
  });

  it("shows a tool call with its input as indented JSON", () => {
    expect(
      useRunEvent({
        type: "harness",
        event: {
          type: "tool-call",
          toolCall: {
            id: "c1",
            name: "read_file",
            arguments: { path: "note.txt" },
          },
        },
      }),
    ).toEqual({
      kind: "tool-call",
      name: "read_file",
      input: '{\n  "path": "note.txt"\n}',
    });
  });

  it("shows a tool result with its content", () => {
    expect(
      useRunEvent({
        type: "harness",
        event: {
          type: "tool-result",
          message: { role: "tool", toolCallId: "c1", content: "blue" },
        },
      }),
    ).toEqual({ kind: "tool-result", content: "blue" });
  });

  it("shows nothing for events that carry no text", () => {
    expect(
      useRunEvent({
        type: "harness",
        event: { type: "reasoning-delta", delta: "hmm" },
      }),
    ).toEqual({ kind: "none" });
  });

  it("shows the end reason and token counts", () => {
    expect(
      useRunEvent({
        type: "ended",
        reason: "stop",
        usage: { inputTokens: 12, outputTokens: 3 },
        tracePath: "/data/traces/r1.jsonl",
      }),
    ).toEqual({
      kind: "ended",
      reason: "stop",
      inputTokens: "12",
      outputTokens: "3",
      tracePath: "/data/traces/r1.jsonl",
    });
  });
});
