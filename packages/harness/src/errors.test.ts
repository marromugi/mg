import { describe, expect, test } from "vitest";
import { HarnessIncompleteError } from "./errors.js";

describe("HarnessIncompleteError", () => {
  test("is an Error with the right name", () => {
    const error = new HarnessIncompleteError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("HarnessIncompleteError");
  });
});
