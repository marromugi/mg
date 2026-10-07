import { describe, expect, it } from "vitest";
import { useOrbLook } from "./useOrbLook.js";

describe("useOrbLook", () => {
  it("gives the same look for the same seed", () => {
    expect(useOrbLook("files")).toEqual(useOrbLook("files"));
  });

  it("gives another look for another seed", () => {
    expect(useOrbLook("files")).not.toEqual(useOrbLook("reviewer"));
  });

  it("keeps the eyes inside the face", () => {
    for (const seed of ["files", "reviewer", "chat", "shell", ""]) {
      const look = useOrbLook(seed);

      expect(look.hue).toBeGreaterThanOrEqual(0);
      expect(look.hue).toBeLessThan(1);
      expect(look.eyeGap + look.eyeWidth).toBeLessThan(0.6);
    }
  });
});
