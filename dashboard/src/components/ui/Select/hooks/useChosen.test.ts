import { describe, expect, it } from "vitest";
import { useChosen } from "./useChosen.js";

const options = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "ollama", label: "Ollama" },
];

describe("useChosen", () => {
  it("gives the option with the value", () => {
    expect(useChosen(options, "ollama")).toEqual({
      kind: "chosen",
      option: { value: "ollama", label: "Ollama" },
    });
  });

  it("gives none when no value is set", () => {
    expect(useChosen(options, undefined)).toEqual({ kind: "none" });
  });

  it("gives none when no option has the value", () => {
    expect(useChosen(options, "other")).toEqual({ kind: "none" });
  });
});
