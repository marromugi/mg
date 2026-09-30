import { describe, expect, it } from "vitest";
import { generalLimits, spanLimits } from "./limits.js";

describe("spanLimits", () => {
  it("equals the SDK's own defaults except an unlimited event count", () => {
    expect(spanLimits).toEqual({
      attributeValueLengthLimit: Infinity,
      attributeCountLimit: 128,
      eventCountLimit: Infinity,
      linkCountLimit: 128,
      attributePerEventCountLimit: 128,
      attributePerLinkCountLimit: 128,
    });
  });
});

describe("generalLimits", () => {
  it("equals the SDK's own defaults for an empty environment", () => {
    expect(generalLimits).toEqual({
      attributeValueLengthLimit: Infinity,
      attributeCountLimit: 128,
    });
  });
});
