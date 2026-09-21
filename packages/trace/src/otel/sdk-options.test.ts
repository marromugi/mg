import { test } from "vitest";
import { createTraceSdk } from "./sdk.js";

test("does not accept a sampler option", () => {
  // @ts-expect-error TraceSdkOptions has no sampler field
  void createTraceSdk({ sampler: undefined });
});

test("does not accept a spanLimits option", () => {
  // @ts-expect-error TraceSdkOptions has no spanLimits field
  void createTraceSdk({ spanLimits: {} });
});
