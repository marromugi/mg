import { describe, expect, it } from "vitest";
import { parseScheme } from "./scheme.js";

describe("parseScheme", () => {
  it("returns light for light and dark for dark", () => {
    expect(parseScheme("light")).toBe("light");
    expect(parseScheme("dark")).toBe("dark");
  });

  it("returns system for any other value", () => {
    expect(parseScheme("system")).toBe("system");
    expect(parseScheme("blue")).toBe("system");
    expect(parseScheme(undefined)).toBe("system");
    expect(parseScheme(42)).toBe("system");
  });
});
