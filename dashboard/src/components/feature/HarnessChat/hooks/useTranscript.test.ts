import { describe, expect, it } from "vitest";
import type { Shown } from "../../../../trial/shown.js";
import type { ChatItem } from "../transcript.js";
import { withEvent, withSent, withStopped } from "./useTranscript.js";

const code = (text: string): Shown => ({
  kind: "code",
  language: "text",
  text,
});

const ASKED: ChatItem[] = [{ kind: "user", id: "0", text: "いますか" }];

describe("withSent", () => {
  it("adds what the person sent", () => {
    expect(withSent([], "いますか", false)).toEqual(ASKED);
  });

  it("marks where the conversation starts over", () => {
    expect(withSent(ASKED, "もう一度", true)).toEqual([
      ...ASKED,
      { kind: "restarted", id: "1" },
      { kind: "user", id: "2", text: "もう一度" },
    ]);
  });
});

describe("withEvent", () => {
  it("joins text that arrives in pieces into one answer", () => {
    const first = withEvent(ASKED, { type: "text", delta: "は" });

    expect(withEvent(first, { type: "text", delta: "い" })).toEqual([
      ...ASKED,
      { kind: "assistant", id: "1", text: "はい" },
    ]);
  });

  it("puts a tool's result on its call", () => {
    const called = withEvent(ASKED, {
      type: "tool-call",
      id: "c1",
      name: "read_file",
      input: code("{}"),
    });

    expect(
      withEvent(called, {
        type: "tool-result",
        id: "c1",
        result: code("# x"),
        refused: false,
      }),
    ).toEqual([
      ...ASKED,
      {
        kind: "tool",
        id: "1:c1",
        name: "read_file",
        input: code("{}"),
        result: { shown: code("# x"), refused: false },
      },
    ]);
  });

  it("adds the reason an answer failed", () => {
    expect(
      withEvent(ASKED, {
        type: "failed",
        message: "connection refused",
      }),
    ).toEqual([
      ...ASKED,
      { kind: "failed", id: "1", message: "connection refused" },
    ]);
  });
});

describe("withStopped", () => {
  it("marks where the answer was stopped", () => {
    expect(withStopped(ASKED)).toEqual([
      ...ASKED,
      { kind: "stopped", id: "1" },
    ]);
  });
});
