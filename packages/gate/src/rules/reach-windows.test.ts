import { win32 } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { GateError } from "../errors.js";
import { TOOL_CALL_KIND } from "../tool-gate.js";
import { createRulesGate } from "./index.js";

vi.mock("node:path", async () => {
  const actual =
    await vi.importActual<typeof import("node:path")>("node:path");
  return { ...actual.win32, default: actual.win32 };
});

const judgeWith = (path: string) =>
  createRulesGate({ root: process.cwd(), rules: [] }).judge({
    kind: TOOL_CALL_KIND,
    description: "raw",
    payload: {
      call: { id: "call-1", name: "read_file", arguments: {} },
      reach: { kind: "paths", paths: [{ path, extent: "file" }] },
    },
  });

describe("rules gate on Windows paths", () => {
  test.each(["\\x", "/x", "C:x"])(
    "refuses %s as a path with no drive",
    async (path) => {
      const error = await judgeWith(path).catch(
        (thrown: unknown) => thrown,
      );

      expect(error).toBeInstanceOf(GateError);
      expect((error as Error).message).toBe(
        `Rules gate payload has a malformed reach: reach.paths[0].path must be an absolute path, got ${JSON.stringify(path)}`,
      );
    },
  );

  test.each(["C:\\x", "\\\\server\\share\\x"])(
    "accepts %s",
    async (path) => {
      expect(win32.isAbsolute(path)).toBe(true);
      expect(await judgeWith(path)).toEqual({
        allowed: true,
        reason: "No rule matched.",
      });
    },
  );
});
