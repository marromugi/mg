import { describe, expect, it } from "vitest";
import { useSelectedIds, useSelectionRecord } from "./useSelection.js";

describe("useSelectionRecord", () => {
  it("marks each id as selected", () => {
    expect(useSelectionRecord(["a", "c"])).toEqual({
      a: true,
      c: true,
    });
  });

  it("is empty for no ids", () => {
    expect(useSelectionRecord([])).toEqual({});
  });
});

describe("useSelectedIds", () => {
  it("lists the ids marked as selected", () => {
    expect(useSelectedIds({ a: true, c: true })).toEqual(["a", "c"]);
  });

  it("is empty for an empty record", () => {
    expect(useSelectedIds({})).toEqual([]);
  });
});
