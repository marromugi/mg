import { describe, expect, it } from "vitest";
import { jsonAttribute } from "./json.js";

describe("jsonAttribute", () => {
  it("stringifies a structured value", () => {
    expect(jsonAttribute({ a: 1 })).toBe('{"a":1}');
  });

  it("falls back to String() for a value JSON.stringify cannot serialize", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;

    expect(() => jsonAttribute(cyclic)).not.toThrow();
    expect(jsonAttribute(cyclic)).toBe(String(cyclic));
  });

  it("falls back to String() for a value JSON.stringify returns undefined for", () => {
    expect(jsonAttribute(undefined)).toBe("undefined");
  });
});
