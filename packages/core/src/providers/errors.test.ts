import { describe, expect, expectTypeOf, test } from "vitest";
import type { ProviderError } from "./errors.js";
import {
  isProviderError,
  ProviderBaseError,
  ProviderHttpError,
  ProviderTransportError,
  ToolArgumentsError,
  ToolSchemaError,
} from "./errors.js";

describe("ProviderHttpError", () => {
  test("carries the status and body", () => {
    const error = new ProviderHttpError("x", 500, "body");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ProviderBaseError);
    expect(error.name).toBe("ProviderHttpError");
    expect(error.message).toBe("x");
    expect(error.status).toBe(500);
    expect(error.body).toBe("body");
    expect(error.cause).toBeUndefined();
  });

  test("keeps the original exception when given one", () => {
    const cause = new Error("boom");
    const error = new ProviderHttpError("x", 500, "body", { cause });

    expect(error.cause).toBe(cause);
  });
});

describe("ProviderTransportError", () => {
  test("carries the original exception", () => {
    const cause = new TypeError("fetch failed");
    const error = new ProviderTransportError("x", { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ProviderBaseError);
    expect(error.name).toBe("ProviderTransportError");
    expect(error.message).toBe("x");
    expect(error.cause).toBe(cause);
  });
});

describe("ToolArgumentsError", () => {
  test("carries the tool call it came from", () => {
    const error = new ToolArgumentsError("call-1", "weather", "{ not json");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ProviderBaseError);
    expect(error.name).toBe("ToolArgumentsError");
    expect(error.toolCallId).toBe("call-1");
    expect(error.toolName).toBe("weather");
    expect(error.raw).toBe("{ not json");
    expect(error.cause).toBeUndefined();
  });

  test("keeps the original exception when given one", () => {
    const cause = new SyntaxError("Unexpected token");
    const error = new ToolArgumentsError("call-1", "weather", "{ not json", { cause });

    expect(error.cause).toBe(cause);
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
        case "ProviderHttpError":
          expectTypeOf(error).toEqualTypeOf<ProviderHttpError>();
          return `http:${error.status}`;
        case "ProviderTransportError":
          expectTypeOf(error).toEqualTypeOf<ProviderTransportError>();
          return `transport:${error.message}`;
        case "ToolArgumentsError":
          expectTypeOf(error).toEqualTypeOf<ToolArgumentsError>();
          return `arguments:${error.toolCallId}`;
        case "ToolSchemaError":
          expectTypeOf(error).toEqualTypeOf<ToolSchemaError>();
          return `schema:${error.toolName}`;
      }
    };

    const cause = new Error("boom");

    expect(describeError(new ProviderHttpError("x", 429, "body"))).toBe("http:429");
    expect(describeError(new ProviderTransportError("offline", { cause }))).toBe("transport:offline");
    expect(describeError(new ToolArgumentsError("call-1", "weather", "{"))).toBe("arguments:call-1");
    expect(describeError(new ToolSchemaError("weather", { cause }))).toBe("schema:weather");
  });
});

describe("isProviderError", () => {
  test("accepts every subclass", () => {
    const cause = new Error("boom");

    expect(isProviderError(new ProviderHttpError("x", 500, "body"))).toBe(true);
    expect(isProviderError(new ProviderTransportError("x", { cause }))).toBe(true);
    expect(isProviderError(new ToolArgumentsError("call-1", "weather", "{"))).toBe(true);
    expect(isProviderError(new ToolSchemaError("weather", { cause }))).toBe(true);
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
            case "ProviderHttpError":
              expectTypeOf(error).toEqualTypeOf<ProviderHttpError>();
              return `http:${error.status}`;
            case "ProviderTransportError":
              expectTypeOf(error).toEqualTypeOf<ProviderTransportError>();
              return `transport:${error.message}`;
            case "ToolArgumentsError":
              expectTypeOf(error).toEqualTypeOf<ToolArgumentsError>();
              return `arguments:${error.toolCallId}`;
            case "ToolSchemaError":
              expectTypeOf(error).toEqualTypeOf<ToolSchemaError>();
              return `schema:${error.toolName}`;
          }
        }

        expectTypeOf(error).toEqualTypeOf<unknown>();
        return "other";
      }
    };

    const cause = new Error("boom");

    expect(describeThrown(new ProviderHttpError("x", 503, "body"))).toBe("http:503");
    expect(describeThrown(new ProviderTransportError("offline", { cause }))).toBe("transport:offline");
    expect(describeThrown(new ToolArgumentsError("call-1", "weather", "{"))).toBe("arguments:call-1");
    expect(describeThrown(new ToolSchemaError("weather", { cause }))).toBe("schema:weather");
    expect(describeThrown(new Error("plain"))).toBe("other");
  });
});
