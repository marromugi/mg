import { describe, expect, it } from "vitest";
import { useDescribedBy } from "./useDescribedBy.js";

describe("useDescribedBy", () => {
  it("names nothing when the field has no hint and no error", () => {
    expect(useDescribedBy("name", {})).toBe(undefined);
  });

  it("names the hint", () => {
    expect(useDescribedBy("name", { hint: "説明" })).toBe("name-hint");
  });

  it("names the hint and then the error", () => {
    expect(
      useDescribedBy("name", { hint: "説明", error: "エラー" }),
    ).toBe("name-hint name-error");
  });
});
