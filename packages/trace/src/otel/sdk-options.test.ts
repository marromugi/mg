import { expect, test } from "vitest";
import { createTraceSdk } from "./sdk.js";

test("does not accept a sampler option", () => {
  // @ts-expect-error TraceSdkOptions has no sampler field
  void createTraceSdk({ sampler: undefined });

  expect(true).toBe(true);
});

test("does not accept a spanLimits option", () => {
  // @ts-expect-error TraceSdkOptions has no spanLimits field
  void createTraceSdk({ spanLimits: {} });

  expect(true).toBe(true);
});
