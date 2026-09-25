import { describe, expect, test } from "vitest";
import { StreamIncompleteError } from "./errors.js";

describe("StreamIncompleteError", () => {
  test("is an Error with the right name", () => {
    const error = new StreamIncompleteError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("StreamIncompleteError");
  });
});
