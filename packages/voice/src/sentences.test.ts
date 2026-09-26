import { describe, expect, test } from "vitest";
import { splitSentences } from "./sentences.js";

describe("splitSentences", () => {
  test("splits sentences from the middle of a turn and reports where the next one should start", () => {
    expect(splitSentences("はい。わかりました。次", 0, false)).toEqual({
      sentences: [
        { text: "はい。", end: 3 },
        { text: "わかりました。", end: 10 },
      ],
      next: 10,
    });
  });

  test("ends a sentence at a period followed by a space but not at one inside a decimal number", () => {
    expect(splitSentences("Yes. 3.5 です。", 0, true)).toEqual({
      sentences: [
        { text: "Yes.", end: 4 },
        { text: "3.5 です。", end: 12 },
      ],
      next: 12,
    });
  });

  test("ends a sentence at a line break, mid-turn, without counting the line break into its end position", () => {
    expect(splitSentences("一行目\n二行目\n三", 0, false)).toEqual({
      sentences: [
        { text: "一行目", end: 3 },
        { text: "二行目", end: 7 },
      ],
      next: 8,
    });
  });

  test("keeps a run of terminators together as a single ending", () => {
    expect(splitSentences("本当に？！", 0, true)).toEqual({
      sentences: [{ text: "本当に？！", end: 5 }],
      next: 5,
    });
  });

  test("does not end a sentence at a terminator nested inside an open quote, and keeps the closing quote with the sentence", () => {
    expect(splitSentences("彼は「行く。」と言った。", 0, true)).toEqual(
      {
        sentences: [{ text: "彼は「行く。」と言った。", end: 12 }],
        next: 12,
      },
    );
  });

  test("withholds a sentence whose ending terminator sits at the end of the text when the turn is not finished", () => {
    expect(splitSentences("はい。", 0, false)).toEqual({
      sentences: [],
      next: 0,
    });
  });

  test("returns the withheld sentence once the turn ends", () => {
    expect(splitSentences("はい。", 0, true)).toEqual({
      sentences: [{ text: "はい。", end: 3 }],
      next: 3,
    });
  });

  test("returns the remaining text as one sentence when the turn ends without a terminator", () => {
    expect(splitSentences("了解です", 0, true)).toEqual({
      sentences: [{ text: "了解です", end: 4 }],
      next: 4,
    });
  });

  test("skips blank-only stretches between sentences without turning them into empty sentences", () => {
    expect(splitSentences(" はい。\n\n いいえ。x", 0, false)).toEqual({
      sentences: [
        { text: "はい。", end: 4 },
        { text: "いいえ。", end: 11 },
      ],
      next: 11,
    });
  });

  test("starts scanning from the given offset and skips the part already returned", () => {
    expect(splitSentences("はい。わかりました。次", 3, false)).toEqual({
      sentences: [{ text: "わかりました。", end: 10 }],
      next: 10,
    });
  });

  test("throws a RangeError naming the text length and the given offset when the offset is past the end of the text", () => {
    const text = "ありがとう";
    expect(() => splitSentences(text, 6, false)).toThrow(RangeError);
    expect(() => splitSentences(text, 6, false)).toThrow(/5/);
    expect(() => splitSentences(text, 6, false)).toThrow(/6/);
  });
});
