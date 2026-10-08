import { describe, expect, it } from "vitest";
import { useOrigin, usePlacement } from "./usePlacement.js";

describe("usePlacement", () => {
  it("is the direction alone when centred", () => {
    expect(usePlacement("bottom", "center")).toBe("bottom");
  });

  it("adds the alignment to the direction", () => {
    expect(usePlacement("right", "start")).toBe("right-start");
    expect(usePlacement("top", "end")).toBe("top-end");
  });
});

describe("useOrigin", () => {
  it("is the middle of the edge facing the trigger when centred", () => {
    expect(useOrigin("bottom")).toBe("top center");
    expect(useOrigin("right")).toBe("left center");
  });

  it("is the corner nearest the trigger above or below it", () => {
    expect(useOrigin("bottom-start")).toBe("top left");
    expect(useOrigin("top-end")).toBe("bottom right");
  });

  it("is the corner nearest the trigger beside it", () => {
    expect(useOrigin("right-start")).toBe("left top");
    expect(useOrigin("left-end")).toBe("right bottom");
  });
});
