import { describe, expect, test } from "vitest";
import { TriggerError } from "./errors.js";

describe("TriggerError", () => {
  test("is an Error with the right name and cause", () => {
    const cause = new Error("boom");
    const error = new TriggerError("Trigger judgement failed", {
      cause,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("TriggerError");
    expect(error.message).toBe("Trigger judgement failed");
    expect(error.cause).toBe(cause);
  });
});
