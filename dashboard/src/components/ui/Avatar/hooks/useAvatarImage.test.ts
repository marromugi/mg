import { describe, expect, it } from "vitest";
import { useAvatarImage } from "./useAvatarImage.js";

describe("useAvatarImage", () => {
  it("draws an SVG image", () => {
    expect(useAvatarImage("files")).toMatch(/^data:image\/svg\+xml/);
  });

  it("draws the same face for the same seed", () => {
    expect(useAvatarImage("files")).toBe(useAvatarImage("files"));
  });

  it("draws another face for another seed", () => {
    expect(useAvatarImage("files")).not.toBe(
      useAvatarImage("reviewer"),
    );
  });
});
