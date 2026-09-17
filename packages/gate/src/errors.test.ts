import { describe, expect, test } from "vitest";
import { GateError } from "./errors.js";

describe("GateError", () => {
  test("is an Error with the right name and cause", () => {
    const cause = new Error("boom");
    const error = new GateError("judgement failed", { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("GateError");
    expect(error.cause).toBe(cause);
  });
});
