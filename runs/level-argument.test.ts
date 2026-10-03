import { describe, expect, test } from "vitest";
import { readLevel } from "./level-argument.ts";

describe("readLevel", () => {
  test("reads a number of dB", () => {
    expect(readLevel("-35.5", -40, "usage")).toEqual({
      ok: true,
      levelDb: -35.5,
    });
  });

  test("uses the fallback when no level is given", () => {
    expect(readLevel(undefined, -40, "usage")).toEqual({
      ok: true,
      levelDb: -40,
    });
  });

  test("returns the usage for text that is not a number", () => {
    expect(readLevel("loud", -40, "usage")).toEqual({
      ok: false,
      usage: "usage",
    });
  });
});
