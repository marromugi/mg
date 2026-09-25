import type { Message } from "@mg/core";
import { describe, expect, test } from "vitest";
import { keepDelivered } from "./keep-delivered.js";

const A1: Message = {
  role: "assistant",
  parts: [
    { type: "text", text: "Hello there." },
    { type: "tool-call", id: "c1", name: "ask", arguments: {} },
  ],
};

const T1: Message = {
  role: "tool",
  toolCallId: "c1",
  content: "queued: w1",
};

const A2: Message = {
  role: "assistant",
  parts: [{ type: "text", text: "It is queued. I will tell you." }],
};

describe("keepDelivered", () => {
  test("keeps earlier turns whole and cuts the target turn's text to the given length", () => {
    expect(
      keepDelivered([A1, T1, A2], { kind: "until", turn: 1, end: 5 }),
    ).toEqual([
      A1,
      T1,
      { role: "assistant", parts: [{ type: "text", text: "It is" }] },
    ]);
  });

  test("drops a later turn entirely when cutting at the start of an earlier turn's text", () => {
    expect(
      keepDelivered([A1, T1, A2], { kind: "until", turn: 0, end: 0 }),
    ).toEqual([
      {
        role: "assistant",
        parts: [
          { type: "tool-call", id: "c1", name: "ask", arguments: {} },
        ],
      },
      T1,
    ]);
  });

  test("keeps a reasoning part in the target turn while cutting its text part", () => {
    const message: Message = {
      role: "assistant",
      parts: [
        { type: "reasoning", text: "think" },
        { type: "text", text: "Yes. No." },
      ],
    };

    expect(
      keepDelivered([message], { kind: "until", turn: 0, end: 4 }),
    ).toEqual([
      {
        role: "assistant",
        parts: [
          { type: "reasoning", text: "think" },
          { type: "text", text: "Yes." },
        ],
      },
    ]);
  });

  test("cuts across several text parts of the target turn in order", () => {
    const message: Message = {
      role: "assistant",
      parts: [
        { type: "text", text: "ab" },
        { type: "text", text: "cd" },
      ],
    };

    expect(
      keepDelivered([message], { kind: "until", turn: 0, end: 3 }),
    ).toEqual([
      {
        role: "assistant",
        parts: [
          { type: "text", text: "ab" },
          { type: "text", text: "c" },
        ],
      },
    ]);
  });

  test("drops an assistant message left with no parts", () => {
    expect(
      keepDelivered([A2], { kind: "until", turn: 0, end: 0 }),
    ).toEqual([]);
  });

  test("returns the given messages unchanged when the position is 'all'", () => {
    expect(keepDelivered([A1, T1, A2], { kind: "all" })).toEqual([
      A1,
      T1,
      A2,
    ]);
  });

  test("throws a range error naming the given turn and the assistant message count when the turn is out of range", () => {
    expect(() =>
      keepDelivered([A1, T1, A2], { kind: "until", turn: 2, end: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      keepDelivered([A1, T1, A2], { kind: "until", turn: 2, end: 0 }),
    ).toThrow(/2/);
    expect(() =>
      keepDelivered([A1, T1, A2], { kind: "until", turn: -1, end: 0 }),
    ).toThrow(RangeError);
  });

  test("throws a range error naming the given end and the turn's text length when the end is out of range", () => {
    expect(() =>
      keepDelivered([A1, T1, A2], { kind: "until", turn: 0, end: 13 }),
    ).toThrow(RangeError);
    expect(() =>
      keepDelivered([A1, T1, A2], { kind: "until", turn: 0, end: 13 }),
    ).toThrow(/13/);
    expect(() =>
      keepDelivered([A1, T1, A2], { kind: "until", turn: 0, end: 13 }),
    ).toThrow(/12/);
    expect(() =>
      keepDelivered([A1, T1, A2], { kind: "until", turn: 0, end: -1 }),
    ).toThrow(RangeError);
  });
});
