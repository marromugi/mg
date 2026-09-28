import { describe, expect, test } from "vitest";
import { ProviderHttpError } from "../providers/errors.js";
import {
  EstimatorHttpError,
  EstimatorResponseError,
  EstimatorRetryExhaustedError,
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

describe("retryable mark and retryAfterMs", () => {
  test("is not retryable and has no retryAfterMs when created without a mark", () => {
    const cause = new Error("boom");

    const httpError = new EstimatorHttpError("x", 503, "busy");
    const transportError = new EstimatorTransportError("x", { cause });
    const responseError = new EstimatorResponseError("x");

    expect(httpError.retryable).toBe(false);
    expect(httpError.retryAfterMs).toBeUndefined();
    expect(transportError.retryable).toBe(false);
    expect(transportError.retryAfterMs).toBeUndefined();
    expect(responseError.retryable).toBe(false);
    expect(responseError.retryAfterMs).toBeUndefined();
  });

  test("carries the retryable mark and retryAfterMs it was created with", () => {
    const httpError = new EstimatorHttpError("x", 503, "busy", {
      retryable: true,
      retryAfterMs: 2000,
    });

    expect(httpError.retryable).toBe(true);
    expect(httpError.retryAfterMs).toBe(2000);

    const cause = new Error("boom");
    const transportError = new EstimatorTransportError("x", {
      cause,
      retryable: true,
    });

    expect(transportError.retryable).toBe(true);
    expect(transportError.retryAfterMs).toBeUndefined();
  });
});

describe("EstimatorRetryExhaustedError", () => {
  test("carries the attempt count and the cause", () => {
    const cause = new EstimatorTransportError("x", {
      cause: new Error("boom"),
    });

    const error = new EstimatorRetryExhaustedError(3, { cause });

    expect(error.attempts).toBe(3);
    expect(error.cause).toBe(cause);
    expect(error.retryable).toBe(false);
    expect(error.retryAfterMs).toBeUndefined();
  });

  test("is recognized as an Estimator error, with a fixed name and message", () => {
    const cause = new EstimatorTransportError("x", {
      cause: new Error("boom"),
    });
    const error = new EstimatorRetryExhaustedError(3, { cause });

    expect(isEstimatorError(error)).toBe(true);
    expect(error.name).toBe("EstimatorRetryExhaustedError");
    expect(error.message).toBe(
      "Estimator retries exhausted (attempts: 3)",
    );
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
