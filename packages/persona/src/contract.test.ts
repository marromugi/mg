import { describe, expect, test } from "vitest";
import { checkExtraction } from "./contract.js";
import type { Counterpart, Extraction } from "./types.js";

const counterparts: Counterpart[] = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
];

describe("checkExtraction", () => {
  test("reports unknown-counterpart when an item's counterpart is not in the counterpart list", () => {
    const extraction: Extraction = {
      summary: "s",
      items: [{ counterpart: "carol", text: "x" }],
    };

    const error = checkExtraction(extraction, counterparts);

    expect(error?.kind).toBe("unknown-counterpart");
  });

  test("reports empty-text when an item's text is blank", () => {
    const extraction: Extraction = {
      summary: "s",
      items: [{ counterpart: "alice", text: " " }],
    };

    const error = checkExtraction(extraction, counterparts);

    expect(error?.kind).toBe("empty-text");
  });

  test("reports duplicate-item when the same counterpart and text appear twice", () => {
    const extraction: Extraction = {
      summary: "s",
      items: [
        { counterpart: "alice", text: "has a dog" },
        { counterpart: "alice", text: "has a dog" },
      ],
    };

    const error = checkExtraction(extraction, counterparts);

    expect(error?.kind).toBe("duplicate-item");
  });
});
