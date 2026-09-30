import { describe, expect, test } from "vitest";
import { ProviderRequestError } from "../providers/errors.js";
import {
  EstimatorRequestError,
  EstimatorResponseError,
  EstimatorRetryExhaustedError,
  isEstimatorError,
} from "./errors.js";

describe("EstimatorRequestError", () => {
  test("carries the cause and the retry mark, and has no status or body", () => {
    const cause = new Error("down");
    const error = new EstimatorRequestError("x", {
      cause,
      retryable: true,
      retryAfterMs: 500,
    });

    expect(error.name).toBe("EstimatorRequestError");
    expect(error.message).toBe("x: down");
    expect(error.messageWithoutServiceText).toBe("x: down");
    expect(error.cause).toBe(cause);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(500);
    expect(isEstimatorError(error)).toBe(true);
    expect("status" in error).toBe(false);
    expect("body" in error).toBe(false);
  });

  test("is not retryable and has no retryAfterMs when created with only its words", () => {
    const error = new EstimatorRequestError("x");

    expect(error.message).toBe("x");
    expect(error.retryable).toBe(false);
    expect(error.retryAfterMs).toBeUndefined();
  });
});

describe("EstimatorResponseError", () => {
  test("has its class name as its name", () => {
    expect(new EstimatorResponseError("x").name).toBe(
      "EstimatorResponseError",
    );
  });
});

describe("EstimatorResponseError", () => {
  test("carries the original exception as cause", () => {
    const cause = new Error("boom");
    const error = new EstimatorResponseError("x", { cause });

    expect(error.cause).toBe(cause);
  });
});

describe("message composition", () => {
  test("ends with each message down the cause chain", () => {
    const error = new EstimatorRequestError("Jev request failed", {
      cause: new TypeError("fetch failed", {
        cause: new Error("connect ECONNREFUSED 127.0.0.1:59999"),
      }),
    });

    expect(error.message).toBe(
      "Jev request failed: fetch failed: connect ECONNREFUSED 127.0.0.1:59999",
    );
  });

  test("states the network text once when an Estimator error sits in the chain", () => {
    const error = new EstimatorRetryExhaustedError(3, {
      cause: new EstimatorRequestError("Jev request failed", {
        cause: new TypeError("fetch failed", {
          cause: new Error("connect ECONNREFUSED 127.0.0.1:59999"),
        }),
      }),
    });

    expect(error.message).toBe(
      "Estimator retries exhausted (attempts: 3): Jev request failed: fetch failed: connect ECONNREFUSED 127.0.0.1:59999",
    );
  });

  test("appends a string cause and ends there", () => {
    const own = "Jev request failed";

    expect(
      new EstimatorResponseError(own, { cause: "socket hang up" })
        .message,
    ).toBe("Jev request failed: socket hang up");
    expect(new EstimatorResponseError(own, { cause: "" }).message).toBe(
      "Jev request failed",
    );
    expect(
      new EstimatorResponseError(own, {
        cause: new TypeError("fetch failed", {
          cause: "socket hang up",
        }),
      }).message,
    ).toBe("Jev request failed: fetch failed: socket hang up");
  });

  test("marks a cause that is not an Error, at any depth", () => {
    const own = "Jev request failed";

    expect(
      new EstimatorResponseError(own, { cause: { code: 1 } }).message,
    ).toBe("Jev request failed: (non-Error cause)");
    expect(
      new EstimatorResponseError(own, {
        cause: new TypeError("fetch failed", { cause: { code: 1 } }),
      }).message,
    ).toBe("Jev request failed: fetch failed: (non-Error cause)");
  });

  test("adds nothing for an empty message and reads on below it", () => {
    const error = new EstimatorResponseError("Jev request failed", {
      cause: new TypeError("", {
        cause: new Error("connect ECONNREFUSED 127.0.0.1:59999"),
      }),
    });

    expect(error.message).toBe(
      "Jev request failed: connect ECONNREFUSED 127.0.0.1:59999",
    );
  });

  test("keeps its own words without a cause and stops at a loop", () => {
    const loop = new Error("loop");
    loop.cause = loop;

    expect(
      new EstimatorResponseError("Jev response failed validation")
        .message,
    ).toBe("Jev response failed validation");
    expect(
      new EstimatorResponseError("Jev request failed", { cause: loop })
        .message,
    ).toBe("Jev request failed: loop");
  });
});

describe("retryable mark and retryAfterMs", () => {
  test("is not retryable and has no retryAfterMs when created without a mark", () => {
    const responseError = new EstimatorResponseError("x");

    expect(responseError.retryable).toBe(false);
    expect(responseError.retryAfterMs).toBeUndefined();
  });
});

describe("EstimatorRetryExhaustedError", () => {
  test("carries the attempt count and the cause", () => {
    const cause = new EstimatorRequestError("x", {
      cause: new Error("boom"),
    });

    const error = new EstimatorRetryExhaustedError(3, { cause });

    expect(error.attempts).toBe(3);
    expect(error.cause).toBe(cause);
    expect(error.retryable).toBe(false);
    expect(error.retryAfterMs).toBeUndefined();
  });

  test("is recognized as an Estimator error, with a fixed name and message", () => {
    const cause = new EstimatorRequestError("x", {
      cause: new Error("boom"),
    });
    const error = new EstimatorRetryExhaustedError(3, { cause });

    expect(isEstimatorError(error)).toBe(true);
    expect(error.name).toBe("EstimatorRetryExhaustedError");
    expect(error.message).toBe(
      "Estimator retries exhausted (attempts: 3): x: boom",
    );
  });
});

describe("messageWithoutServiceText", () => {
  test("equals message when nothing is marked", () => {
    const error = new EstimatorRequestError("Jev request failed", {
      cause: new Error("network down"),
    });

    expect(error.messageWithoutServiceText).toBe(
      "Jev request failed: network down",
    );
  });

  test("starts from withoutServiceText and leaves message unchanged", () => {
    const error = new EstimatorRequestError(
      "Jev request failed: 503 upstream busy",
      {
        withoutServiceText:
          "Jev request failed: 503 (text from the service left out)",
      },
    );

    expect(error.message).toBe("Jev request failed: 503 upstream busy");
    expect(error.messageWithoutServiceText).toBe(
      "Jev request failed: 503 (text from the service left out)",
    );
  });

  test("replaces the whole cause chain when causeQuotesService is true", () => {
    const error = new EstimatorResponseError(
      "Jev response is not JSON",
      {
        cause: new SyntaxError("Unexpected token '<'"),
        causeQuotesService: true,
      },
    );

    expect(error.message).toBe(
      "Jev response is not JSON: Unexpected token '<'",
    );
    expect(error.messageWithoutServiceText).toBe(
      "Jev response is not JSON: (text from the service left out)",
    );
  });

  test("takes the second text of an Estimator error in the chain", () => {
    const inner = new EstimatorRequestError(
      "Jev request failed: 503 upstream busy",
      {
        withoutServiceText:
          "Jev request failed: 503 (text from the service left out)",
      },
    );

    const error = new EstimatorRetryExhaustedError(3, { cause: inner });

    expect(error.message).toBe(
      "Estimator retries exhausted (attempts: 3): Jev request failed: 503 upstream busy",
    );
    expect(error.messageWithoutServiceText).toBe(
      "Estimator retries exhausted (attempts: 3): Jev request failed: 503 (text from the service left out)",
    );
  });
});

describe("isEstimatorError", () => {
  test("returns true for each of the errors", () => {
    expect(isEstimatorError(new EstimatorRequestError("x"))).toBe(true);
    expect(isEstimatorError(new EstimatorResponseError("x"))).toBe(
      true,
    );
  });

  test("returns false for a plain error and a provider error", () => {
    expect(isEstimatorError(new Error("x"))).toBe(false);
    expect(isEstimatorError(new ProviderRequestError("x"))).toBe(false);
  });
});
