import { describe, expect, it } from "vitest";
import { useNavigation } from "./useNavigation.js";

describe("useNavigation", () => {
  it("lists the places in menu order", () => {
    expect(
      useNavigation("home").map(({ href, label }) => ({ href, label })),
    ).toEqual([
      { href: "/", label: "ホーム" },
      { href: "/harnesses", label: "ハーネス" },
      { href: "/api-keys", label: "API キー" },
    ]);
  });

  it("marks only the place the page belongs to as current", () => {
    expect(
      useNavigation("harnesses").map(({ place, state }) => [
        place,
        state,
      ]),
    ).toEqual([
      ["home", "idle"],
      ["harnesses", "current"],
      ["api-keys", "idle"],
    ]);
  });
});
