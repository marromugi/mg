import { describe, expect, it } from "vitest";
import { useNavigation } from "./useNavigation.js";

describe("useNavigation", () => {
  it("lists the three places and marks the current one", () => {
    expect(useNavigation("harnesses")).toEqual([
      { place: "home", href: "/", label: "ホーム", state: "default" },
      {
        place: "harnesses",
        href: "/harnesses",
        label: "ハーネス",
        state: "current",
      },
      {
        place: "api-keys",
        href: "/api-keys",
        label: "API キー",
        state: "default",
      },
    ]);
  });
});
