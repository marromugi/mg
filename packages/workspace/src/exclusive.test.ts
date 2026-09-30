import { describe, expect, test } from "vitest";
import { DuplicateExclusiveNameError } from "./errors.js";
import { exclusiveNamesOf } from "./exclusive.js";
import type { Connector, Workspace } from "./types.js";

const fakeConnector = (
  exclusive: readonly string[],
  kind = "fake",
): Connector => ({
  kind,
  exclusive,
  open: async () => ({ tools: [], close: async () => {} }),
});

describe("exclusiveNamesOf", () => {
  test("lists every connector's declared names sorted ascending", () => {
    const workspace: Workspace = {
      name: "ws",
      connectors: [fakeConnector(["c", "a"]), fakeConnector(["b"])],
    };

    expect(exclusiveNamesOf(workspace)).toEqual(["a", "b", "c"]);
  });

  test("counts a name listed twice by one connector once", () => {
    const workspace: Workspace = {
      name: "ws",
      connectors: [fakeConnector(["a", "a"])],
    };

    expect(exclusiveNamesOf(workspace)).toEqual(["a"]);
  });

  test("refuses a name declared by two connectors, naming the first shared name", () => {
    const workspace: Workspace = {
      name: "ws",
      connectors: [
        fakeConnector(["z", "b"], "cdp"),
        fakeConnector(["a"], "ssh"),
        fakeConnector(["z", "b"], "browser"),
      ],
    };

    const error = (() => {
      try {
        exclusiveNamesOf(workspace);
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(DuplicateExclusiveNameError);
    expect((error as Error).message).toBe(
      'workspace "ws" has exclusive name "b" declared by more than one connector: cdp at index 0, browser at index 2',
    );
  });

  test("is empty when no connector declares any names", () => {
    const workspace: Workspace = {
      name: "ws",
      connectors: [fakeConnector([]), fakeConnector([])],
    };

    expect(exclusiveNamesOf(workspace)).toEqual([]);
  });
});
