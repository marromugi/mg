import { describe, expect, test } from "vitest";
import { exclusiveNamesOf } from "./exclusive.js";
import type { Connector, Workspace } from "./types.js";

const fakeConnector = (exclusive: readonly string[]): Connector => ({
  kind: "fake",
  exclusive,
  open: async () => ({ tools: [], close: async () => {} }),
});

describe("exclusiveNamesOf", () => {
  test("combines every connector's declared names, without duplicates, sorted ascending", () => {
    const workspace: Workspace = {
      name: "ws",
      connectors: [
        fakeConnector(["b", "a"]),
        fakeConnector(["a", "c"]),
      ],
    };

    expect(exclusiveNamesOf(workspace)).toEqual(["a", "b", "c"]);
  });

  test("is empty when no connector declares any names", () => {
    const workspace: Workspace = {
      name: "ws",
      connectors: [fakeConnector([]), fakeConnector([])],
    };

    expect(exclusiveNamesOf(workspace)).toEqual([]);
  });
});
