import { describe, expect, it } from "vitest";
import { useFittedHeight } from "./useFittedHeight.js";

const measured = { line: 24, padding: 16, borders: 2 };

describe("useFittedHeight", () => {
  it("is as tall as the text when the text fits", () => {
    expect(
      useFittedHeight({ ...measured, content: 4 * 24 + 16 }, 6),
    ).toEqual({ height: 114, scrolls: false });
  });

  it("is exactly the most lines when the text fills them", () => {
    expect(
      useFittedHeight({ ...measured, content: 6 * 24 + 16 }, 6),
    ).toEqual({ height: 162, scrolls: false });
  });

  it("stops at the most lines and scrolls when the text is longer", () => {
    expect(
      useFittedHeight({ ...measured, content: 9 * 24 + 16 }, 6),
    ).toEqual({ height: 162, scrolls: true });
  });
});
