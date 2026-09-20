import { describe, expect, test } from "vitest";
import { ProviderHttpError } from "../providers/errors.js";
import {
  EstimatorHttpError,
  EstimatorResponseError,
  EstimatorTransportError,
  isEstimatorError,
} from "./errors.js";

describe("EstimatorHttpError, EstimatorTransportError, EstimatorResponseError", () => {
  test("each has its class name as its name", () => {
    const cause = new Error("boom");

    expect(new EstimatorHttpError("x", 503, "busy").name).toBe(
      "EstimatorHttpError",
    );
    expect(new EstimatorTransportError("x", { cause }).name).toBe(
      "EstimatorTransportError",
    );
    expect(new EstimatorResponseError("x").name).toBe(
      "EstimatorResponseError",
    );
  });
});

describe("EstimatorHttpError", () => {
  test("carries the status and body", () => {
    const error = new EstimatorHttpError("x", 503, "busy");

    expect(error.status).toBe(503);
    expect(error.body).toBe("busy");
  });
});

describe("EstimatorTransportError", () => {
  test("carries the original exception as cause", () => {
    const cause = new Error("boom");
    const error = new EstimatorTransportError("x", { cause });

    expect(error.cause).toBe(cause);
  });
});

describe("EstimatorResponseError", () => {
  test("carries the original exception as cause", () => {
    const cause = new Error("boom");
    const error = new EstimatorResponseError("x", { cause });

    expect(error.cause).toBe(cause);
  });
});

describe("isEstimatorError", () => {
  test("returns true for each of the three errors", () => {
    const cause = new Error("boom");

    expect(
      isEstimatorError(new EstimatorHttpError("x", 503, "busy")),
    ).toBe(true);
    expect(
      isEstimatorError(new EstimatorTransportError("x", { cause })),
    ).toBe(true);
    expect(isEstimatorError(new EstimatorResponseError("x"))).toBe(
      true,
    );
  });

  test("returns false for a plain error and a provider error", () => {
    expect(isEstimatorError(new Error("x"))).toBe(false);
    expect(isEstimatorError(new ProviderHttpError("x", 500, ""))).toBe(
      false,
    );
  });
});
