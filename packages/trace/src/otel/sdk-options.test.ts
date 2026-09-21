import { expect, test } from "vitest";
import { createTraceSdk } from "./sdk.js";

test("does not accept a sampler option", () => {
  const rejected = () => {
    // @ts-expect-error TraceSdkOptions has no sampler field
    void createTraceSdk({ sampler: undefined });
  };
  void rejected;

  expect(true).toBe(true);
});

test("does not accept a spanLimits option", () => {
  const rejected = () => {
    // @ts-expect-error TraceSdkOptions has no spanLimits field
    void createTraceSdk({ spanLimits: {} });
  };
  void rejected;

  expect(true).toBe(true);
});
