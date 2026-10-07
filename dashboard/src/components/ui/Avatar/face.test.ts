import { describe, expect, it } from "vitest";
import { drawFace } from "./face.js";

describe("drawFace", () => {
  it("draws an SVG document", () => {
    const face = drawFace("files");

    expect(face.startsWith("<svg ")).toBe(true);
    expect(face.endsWith("</svg>")).toBe(true);
  });

  it("draws the same face for the same seed", () => {
    expect(drawFace("files")).toBe(drawFace("files"));
  });

  it("draws another face for another seed", () => {
    expect(drawFace("files")).not.toBe(drawFace("reviewer"));
  });

  it("draws a face for an empty seed", () => {
    expect(drawFace("")).toContain("<svg ");
  });

  it("leaves no blank where a part was to be drawn", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      expect(drawFace(seed)).not.toMatch(/undefined|NaN/);
    }
  });
});
