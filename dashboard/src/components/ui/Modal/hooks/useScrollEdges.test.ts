import { describe, expect, it } from "vitest";
import { useScrollEdges } from "./useScrollEdges.js";

describe("useScrollEdges", () => {
  it("has nothing out of view when the content fits", () => {
    expect(
      useScrollEdges({ offset: 0, content: 300, view: 300 }),
    ).toEqual({
      above: false,
      below: false,
    });
  });

  it("has content below at the start of longer content", () => {
    expect(
      useScrollEdges({ offset: 0, content: 900, view: 300 }),
    ).toEqual({
      above: false,
      below: true,
    });
  });

  it("has content above and below in the middle", () => {
    expect(
      useScrollEdges({ offset: 200, content: 900, view: 300 }),
    ).toEqual({ above: true, below: true });
  });

  it("has content above only at the end", () => {
    expect(
      useScrollEdges({ offset: 600, content: 900, view: 300 }),
    ).toEqual({ above: true, below: false });
  });
});
