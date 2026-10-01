import { describe, expect, expectTypeOf, test } from "vitest";
import type { ProviderError } from "./errors.js";
import {
  isProviderError,
  ProviderBaseError,
  ProviderRequestError,
  ProviderResponseError,
  ProviderRetryExhaustedError,
  ProviderUnsupportedError,
  ToolArgumentsError,
  ToolSchemaError,
} from "./errors.js";

describe("ProviderRequestError", () => {
  test("ends its message with the reason from its cause", () => {
    const cause = new TypeError("fetch failed", {
      cause: new Error("ECONNREFUSED"),
    });
    const error = new ProviderRequestError("x", { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ProviderBaseError);
    expect(error.name).toBe("ProviderRequestError");
    expect(error.message).toBe("x: fetch failed: ECONNREFUSED");
    expect(error.messageWithoutServiceText).toBe(
      "x: fetch failed: ECONNREFUSED",
    );
    expect(error.cause).toBe(cause);
  });

  test("leaves out the text the cause quotes from the service", () => {
    const error = new ProviderRequestError("failed: 503", {
      cause: new Error("upstream busy"),
      causeQuotesService: true,
    });

    expect(error.message).toBe("failed: 503: upstream busy");
    expect(error.messageWithoutServiceText).toBe(
      "failed: 503: (text from the service left out)",
    );
  });
});

describe("ProviderResponseError", () => {
  test("is not retryable and composes its two texts", () => {
    const error = new ProviderResponseError("not JSON", {
      cause: new Error("<html>"),
      withoutServiceText: "not JSON!",
      causeQuotesService: true,
    });

    expect(error).toBeInstanceOf(ProviderBaseError);
    expect(error.name).toBe("ProviderResponseError");
    expect(error.message).toBe("not JSON: <html>");
    expect(error.messageWithoutServiceText).toBe(
      "not JSON!: (text from the service left out)",
    );
    expect(error.retryable).toBe(false);
    expect(error.retryAfterMs).toBeUndefined();
  });
});

describe("ToolArgumentsError", () => {
  test("carries the tool call it came from", () => {
    const error = new ToolArgumentsError(
      "call-1",
      "weather",
      "{ not json",
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ProviderBaseError);
    expect(error.name).toBe("ToolArgumentsError");
    expect(error.toolCallId).toBe("call-1");
    expect(error.toolName).toBe("weather");
    expect(error.raw).toBe("{ not json");
    expect(error.cause).toBeUndefined();
  });

  test("keeps the original exception and leaves its text out of the second text", () => {
    const cause = new SyntaxError("Unexpected token");
    const error = new ToolArgumentsError(
      "call-1",
      "weather",
      "{ not json",
      { cause },
    );

    expect(error.cause).toBe(cause);
    expect(error.message).toBe(
      "Failed to parse arguments for tool call call-1 (weather): Unexpected token",
    );
    expect(error.messageWithoutServiceText).toBe(
      "Failed to parse arguments for tool call call-1 (weather): (text from the service left out)",
    );
  });
});

describe("ToolSchemaError", () => {
  test("carries the tool name and the original exception", () => {
    const cause = new Error("unsupported schema");
    const error = new ToolSchemaError("weather", { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ProviderBaseError);
    expect(error.name).toBe("ToolSchemaError");
    expect(error.toolName).toBe("weather");
    expect(error.cause).toBe(cause);
    expect(error.message).toBe(
      "Failed to convert the schema for tool weather: unsupported schema",
    );
    expect(error.messageWithoutServiceText).toBe(error.message);
  });
});

describe("ProviderUnsupportedError", () => {
  test("carries the unsupported feature", () => {
    const error = new ProviderUnsupportedError(
      "Ollama does not support forcing tool use",
      "tool-choice",
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ProviderBaseError);
    expect(error.name).toBe("ProviderUnsupportedError");
    expect(error.message).toBe(
      "Ollama does not support forcing tool use",
    );
    expect(error.feature).toBe("tool-choice");
    expect(error.cause).toBeUndefined();
  });
});

describe("retry mark", () => {
  const cause = new Error("inner");

  test("is off, with no wait time, when not given", () => {
    const errors = [
      new ProviderRequestError("x"),
      new ProviderResponseError("x", { cause }),
      new ToolArgumentsError("id", "tool", "{"),
      new ToolSchemaError("tool", { cause }),
      new ProviderUnsupportedError("x", "tool-choice"),
    ];

    for (const error of errors) {
      expect(error.retryable).toBe(false);
      expect(error.retryAfterMs).toBeUndefined();
    }
  });

  test("is carried with the wait time given", () => {
    const waiting = new ProviderRequestError("x", {
      retryable: true,
      retryAfterMs: 3000,
    });
    const immediate = new ProviderRequestError("x", {
      cause,
      retryable: true,
    });
    const notRetryable = new ProviderRequestError("x", {
      retryable: false,
    });

    expect(waiting.retryable).toBe(true);
    expect(waiting.retryAfterMs).toBe(3000);
    expect(immediate.retryable).toBe(true);
    expect(immediate.retryAfterMs).toBeUndefined();
    expect(notRetryable.retryable).toBe(false);
  });

  test("refuses a wait time on an error that is not retryable", () => {
    const construct = () =>
      new ProviderRequestError("x", {
        retryable: false,
        // @ts-expect-error a wait time needs retryable: true
        retryAfterMs: 1,
      });

    expect(construct).toBeTypeOf("function");
  });
});

describe("ProviderRetryExhaustedError", () => {
  test("carries the attempts and the last error", () => {
    const cause = new Error("inner");
    const error = new ProviderRetryExhaustedError(3, { cause });

    expect(error.name).toBe("ProviderRetryExhaustedError");
    expect(error.message).toBe(
      "Provider retries exhausted (attempts: 3): inner",
    );
    expect(error.attempts).toBe(3);
    expect(error.cause).toBe(cause);
    expect(error.retryable).toBe(false);
    expect(error.retryAfterMs).toBeUndefined();
    expect(isProviderError(error)).toBe(true);
  });
});

describe("ProviderBaseError", () => {
  test("cannot be constructed directly", () => {
    // @ts-expect-error ProviderBaseError is abstract
    const construct = () => new ProviderBaseError("x");

    expect(construct).toBeTypeOf("function");
  });

  test("narrows to the subclass in a switch on name", () => {
    const describeError = (error: ProviderError): string => {
      switch (error.name) {
        case "ProviderRequestError":
          expectTypeOf(error).toEqualTypeOf<ProviderRequestError>();
          return `request:${error.message}`;
        case "ProviderResponseError":
          expectTypeOf(error).toEqualTypeOf<ProviderResponseError>();
          return `response:${error.message}`;
        case "ToolArgumentsError":
          expectTypeOf(error).toEqualTypeOf<ToolArgumentsError>();
          return `arguments:${error.toolCallId}`;
        case "ToolSchemaError":
          expectTypeOf(error).toEqualTypeOf<ToolSchemaError>();
          return `schema:${error.toolName}`;
        case "ProviderUnsupportedError":
          expectTypeOf(error).toEqualTypeOf<ProviderUnsupportedError>();
          return `unsupported:${error.feature}`;
        case "ProviderRetryExhaustedError":
          expectTypeOf(
            error,
          ).toEqualTypeOf<ProviderRetryExhaustedError>();
          return `exhausted:${error.attempts}`;
      }
    };

    const cause = new Error("boom");

    expect(describeError(new ProviderRequestError("offline"))).toBe(
      "request:offline",
    );
    expect(describeError(new ProviderResponseError("garbled"))).toBe(
      "response:garbled",
    );
    expect(
      describeError(new ToolArgumentsError("call-1", "weather", "{")),
    ).toBe("arguments:call-1");
    expect(
      describeError(new ToolSchemaError("weather", { cause })),
    ).toBe("schema:weather");
    expect(
      describeError(new ProviderUnsupportedError("x", "tool-choice")),
    ).toBe("unsupported:tool-choice");
  });
});

describe("isProviderError", () => {
  test("accepts every subclass", () => {
    const cause = new Error("boom");

    expect(isProviderError(new ProviderRequestError("x"))).toBe(true);
    expect(isProviderError(new ProviderResponseError("x"))).toBe(true);
    expect(
      isProviderError(new ToolArgumentsError("call-1", "weather", "{")),
    ).toBe(true);
    expect(
      isProviderError(new ToolSchemaError("weather", { cause })),
    ).toBe(true);
    expect(
      isProviderError(new ProviderUnsupportedError("x", "tool-choice")),
    ).toBe(true);
  });

  test("rejects anything else", () => {
    expect(isProviderError(new Error("plain"))).toBe(false);
    expect(isProviderError(undefined)).toBe(false);
  });

  test("narrows a caught value to the subclass", () => {
    const describeThrown = (thrown: unknown): string => {
      try {
        throw thrown;
      } catch (error) {
        if (isProviderError(error)) {
          switch (error.name) {
            case "ProviderRequestError":
              expectTypeOf(error).toEqualTypeOf<ProviderRequestError>();
              return `request:${error.message}`;
            case "ProviderResponseError":
              expectTypeOf(
                error,
              ).toEqualTypeOf<ProviderResponseError>();
              return `response:${error.message}`;
            case "ToolArgumentsError":
              expectTypeOf(error).toEqualTypeOf<ToolArgumentsError>();
              return `arguments:${error.toolCallId}`;
            case "ToolSchemaError":
              expectTypeOf(error).toEqualTypeOf<ToolSchemaError>();
              return `schema:${error.toolName}`;
            case "ProviderUnsupportedError":
              expectTypeOf(
                error,
              ).toEqualTypeOf<ProviderUnsupportedError>();
              return `unsupported:${error.feature}`;
            case "ProviderRetryExhaustedError":
              expectTypeOf(
                error,
              ).toEqualTypeOf<ProviderRetryExhaustedError>();
              return `exhausted:${error.attempts}`;
          }
        }

        expectTypeOf(error).toEqualTypeOf<unknown>();
        return "other";
      }
    };

    const cause = new Error("boom");

    expect(describeThrown(new ProviderRequestError("offline"))).toBe(
      "request:offline",
    );
    expect(describeThrown(new ProviderResponseError("garbled"))).toBe(
      "response:garbled",
    );
    expect(
      describeThrown(new ToolArgumentsError("call-1", "weather", "{")),
    ).toBe("arguments:call-1");
    expect(
      describeThrown(new ToolSchemaError("weather", { cause })),
    ).toBe("schema:weather");
    expect(
      describeThrown(new ProviderUnsupportedError("x", "tool-choice")),
    ).toBe("unsupported:tool-choice");
    expect(describeThrown(new Error("plain"))).toBe("other");
  });
});
