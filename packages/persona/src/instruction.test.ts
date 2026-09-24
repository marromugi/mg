import { describe, expect, test } from "vitest";
import { composeInstruction } from "./instruction.js";
import type { RecallHeadings } from "./recall.js";
import type { RecallRead } from "./read.js";

const headings: RecallHeadings = {
  about: "## About",
  earlier: "## Earlier",
};

const itemA = {
  id: "m1",
  counterpart: "alice",
  text: "likes cats",
  createdAt: 300,
  misses: 0,
};
const itemB = {
  id: "m2",
  counterpart: "alice",
  text: "lives in Kyoto",
  createdAt: 200,
  misses: 1,
};
const itemC = {
  id: "m3",
  counterpart: "bob",
  text: "plays go",
  createdAt: 100,
  misses: 0,
};

const baseRead: RecallRead = {
  counterparts: [
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
  ],
  conversation: "t1",
  persona: { text: "I am Jev.", version: 1 },
  summary: { text: "we met", version: 2 },
  items: [itemA, itemB, itemC],
  candidates: ["m1", "m2", "m3"],
  selected: ["m1", "m2"],
};

describe("composeInstruction", () => {
  test("joins the persona text, the per-counterpart sections and the summary with blank lines", () => {
    expect(composeInstruction(baseRead, headings)).toBe(
      "I am Jev.\n\n## About Alice\n- likes cats\n- lives in Kyoto\n\n## Earlier\nwe met",
    );
  });

  test("omits a counterpart section when none of its items were selected", () => {
    const read: RecallRead = { ...baseRead, selected: [] };

    expect(composeInstruction(read, headings)).toBe(
      "I am Jev.\n\n## Earlier\nwe met",
    );
  });

  test("omits the summary section when there is no summary", () => {
    const read: RecallRead = {
      ...baseRead,
      summary: undefined,
      items: [],
      candidates: [],
      selected: [],
    };

    expect(composeInstruction(read, headings)).toBe("I am Jev.");
  });

  test("orders counterpart sections by the counterpart list and items within a section by selected order", () => {
    const read: RecallRead = {
      ...baseRead,
      counterparts: [
        { id: "bob", name: "Bob" },
        { id: "alice", name: "Alice" },
      ],
      selected: ["m1", "m2", "m3"],
    };

    expect(composeInstruction(read, headings)).toBe(
      "I am Jev.\n\n## About Bob\n- plays go\n\n## About Alice\n- likes cats\n- lives in Kyoto\n\n## Earlier\nwe met",
    );
  });
});
