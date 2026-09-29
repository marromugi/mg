import { describe, expect, test } from "vitest";
import { readOneInput } from "./one-input.ts";

describe("readOneInput", () => {
  test("returns the single argument as the input", () => {
    expect(readOneInput(["ls して"], "runs/loop-files.ts")).toEqual({
      ok: true,
      input: "ls して",
    });
  });

  test("returns an empty string argument as the input", () => {
    expect(readOneInput([""], "runs/loop-files.ts")).toEqual({
      ok: true,
      input: "",
    });
  });

  test("returns usage for no arguments", () => {
    expect(readOneInput([], "runs/loop-files.ts")).toEqual({
      ok: false,
      usage: 'usage: node runs/loop-files.ts "<input>"',
    });
  });

  test("returns usage for two arguments", () => {
    expect(readOneInput(["a", "b"], "runs/loop-files.ts")).toEqual({
      ok: false,
      usage: 'usage: node runs/loop-files.ts "<input>"',
    });
  });
});
