import { describe, expect, it } from "vitest";
import { useSteps } from "./useSteps.js";

describe("useSteps", () => {
  it("goes through every step when a tool is chosen", () => {
    expect(useSteps(2).map((step) => step.id)).toEqual([
      "name",
      "model",
      "tools",
      "security",
      "other",
    ]);
  });

  it("leaves out the security step when no tool is chosen", () => {
    expect(useSteps(0).map((step) => step.id)).toEqual([
      "name",
      "model",
      "tools",
      "other",
    ]);
  });
});
