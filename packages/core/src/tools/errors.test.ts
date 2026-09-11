import { describe, expect, expectTypeOf, test } from "vitest";
import { ProviderBaseError } from "../providers/errors.js";
import type { ToolRunError } from "./errors.js";
import { isToolRunError, ToolInputError, ToolNotFoundError, ToolRunBaseError } from "./errors.js";

const issues = [{ message: "Expected string", path: ["city"] }];

describe("ToolNotFoundError", () => {
  test("carries the tool call it came from", () => {
    const error = new ToolNotFoundError("call-1", "weather");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ToolRunBaseError);
    expect(error).not.toBeInstanceOf(ProviderBaseError);
    expect(error.name).toBe("ToolNotFoundError");
    expect(error.toolCallId).toBe("call-1");
    expect(error.toolName).toBe("weather");
  });
});

describe("ToolInputError", () => {
  test("carries the tool call and the issues", () => {
    const error = new ToolInputError("call-1", "weather", issues);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ToolRunBaseError);
    expect(error).not.toBeInstanceOf(ProviderBaseError);
    expect(error.name).toBe("ToolInputError");
    expect(error.toolCallId).toBe("call-1");
    expect(error.toolName).toBe("weather");
    expect(error.issues).toBe(issues);
  });
});

describe("ToolRunBaseError", () => {
  test("cannot be constructed directly", () => {
    // @ts-expect-error ToolRunBaseError is abstract
    const construct = () => new ToolRunBaseError("x", "call-1", "weather");

    expect(construct).toBeTypeOf("function");
  });

  test("narrows to the subclass in a switch on name", () => {
    const describeError = (error: ToolRunError): string => {
      switch (error.name) {
        case "ToolNotFoundError":
          expectTypeOf(error).toEqualTypeOf<ToolNotFoundError>();
          return `not-found:${error.toolName}`;
        case "ToolInputError":
          expectTypeOf(error).toEqualTypeOf<ToolInputError>();
          return `input:${error.issues.length}`;
      }
    };

    expect(describeError(new ToolNotFoundError("call-1", "weather"))).toBe("not-found:weather");
    expect(describeError(new ToolInputError("call-1", "weather", issues))).toBe("input:1");
  });
});

describe("isToolRunError", () => {
  test("accepts every subclass", () => {
    expect(isToolRunError(new ToolNotFoundError("call-1", "weather"))).toBe(true);
    expect(isToolRunError(new ToolInputError("call-1", "weather", issues))).toBe(true);
  });

  test("rejects anything else", () => {
    expect(isToolRunError(new Error("plain"))).toBe(false);
    expect(isToolRunError(undefined)).toBe(false);
  });

  test("narrows a caught value to the subclass", () => {
    const describeThrown = (thrown: unknown): string => {
      try {
        throw thrown;
      } catch (error) {
        if (isToolRunError(error)) {
          switch (error.name) {
            case "ToolNotFoundError":
              expectTypeOf(error).toEqualTypeOf<ToolNotFoundError>();
              return `not-found:${error.toolName}`;
            case "ToolInputError":
              expectTypeOf(error).toEqualTypeOf<ToolInputError>();
              return `input:${error.issues.length}`;
          }
        }

        expectTypeOf(error).toEqualTypeOf<unknown>();
        return "other";
      }
    };

    expect(describeThrown(new ToolNotFoundError("call-1", "weather"))).toBe("not-found:weather");
    expect(describeThrown(new ToolInputError("call-1", "weather", issues))).toBe("input:1");
    expect(describeThrown(new Error("plain"))).toBe("other");
  });
});
