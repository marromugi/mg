import { describe, expect, it } from "vitest";
import { useMatches } from "./useMatches.js";

const options = [
  { value: "gpt-5", label: "OpenAI GPT-5" },
  { value: "sonnet", label: "Claude Sonnet" },
  { value: "opus", label: "Claude Opus" },
];

describe("useMatches", () => {
  it("gives every option when nothing is typed", () => {
    expect(useMatches(options, "").map((each) => each.value)).toEqual([
      "gpt-5",
      "sonnet",
      "opus",
    ]);
  });

  it("gives the options whose name contains what was typed", () => {
    expect(
      useMatches(options, "Claude").map((each) => each.value),
    ).toEqual(["sonnet", "opus"]);
  });

  it("ignores case and the spaces around what was typed", () => {
    expect(
      useMatches(options, "  opus ").map((each) => each.value),
    ).toEqual(["opus"]);
  });

  it("gives nothing when no name contains what was typed", () => {
    expect(useMatches(options, "gemini")).toEqual([]);
  });
});
