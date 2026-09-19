import { describe, expect, test } from "vitest";
import { EvalError, NoRunInSessionError } from "./errors.js";

describe("EvalError", () => {
  test("is an Error with its own name", () => {
    const error = new EvalError("something went wrong");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("EvalError");
  });
});

describe("NoRunInSessionError", () => {
  test("is an EvalError naming the session", () => {
    const error = new NoRunInSessionError("session-1");

    expect(error).toBeInstanceOf(EvalError);
    expect(error.name).toBe("NoRunInSessionError");
    expect(error.message).toContain("session-1");
  });
});
