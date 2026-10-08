import { describe, expect, it } from "vitest";
import { useSummary, useToggled } from "./useSummary.js";

const options = [
  { value: "bash", label: "bash" },
  { value: "read", label: "read_file" },
  { value: "grep", label: "grep" },
];

describe("useSummary", () => {
  it("says nothing when no option is chosen", () => {
    expect(useSummary(options, [])).toEqual({ kind: "none" });
  });

  it("counts the chosen options and names them in option order", () => {
    expect(useSummary(options, ["grep", "bash"])).toEqual({
      kind: "several",
      count: "2 件選択中",
      names: "bash、grep",
    });
  });

  it("names the option when only one is chosen", () => {
    expect(useSummary(options, ["read"])).toEqual({
      kind: "one",
      name: "read_file",
    });
  });

  it("leaves out a chosen value that no option has", () => {
    expect(useSummary(options, ["grep", "gone"])).toEqual({
      kind: "one",
      name: "grep",
    });
  });
});

describe("useToggled", () => {
  it("adds a value that is missing", () => {
    expect(useToggled(["bash"], "grep")).toEqual(["bash", "grep"]);
  });

  it("removes a value that is there", () => {
    expect(useToggled(["bash", "grep"], "bash")).toEqual(["grep"]);
  });
});
