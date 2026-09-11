import type { ToolCall } from "@mg/core";
import { ToolInputError, ToolNotFoundError } from "@mg/core";
import { describe, expect, test } from "vitest";
import { toolErrorToMessage } from "./tool-error.js";

describe("toolErrorToMessage", () => {
  const call: ToolCall = { id: "call-1", name: "a", arguments: {} };

  test("ToolNotFoundError becomes a message starting with [ToolNotFoundError]", () => {
    const error = new ToolNotFoundError(call.id, call.name);

    const message = toolErrorToMessage(call, error);

    expect(message).toEqual({
      role: "tool",
      toolCallId: "call-1",
      content: `[ToolNotFoundError] ${error.message}`,
    });
  });

  test("ToolInputError with two issues appends two - lines", () => {
    const error = new ToolInputError(call.id, call.name, [{ message: "missing x" }, { message: "bad y" }]);

    const message = toolErrorToMessage(call, error);

    expect(message.content).toBe(`[ToolInputError] ${error.message}\n- missing x\n- bad y`);
  });

  test("a plain Error becomes [Error] message", () => {
    const message = toolErrorToMessage(call, new Error("boom"));

    expect(message).toEqual({ role: "tool", toolCallId: "call-1", content: "[Error] boom" });
  });

  test("a non-Error throw becomes [error] String(value)", () => {
    const message = toolErrorToMessage(call, "x");

    expect(message).toEqual({ role: "tool", toolCallId: "call-1", content: "[error] x" });
  });
});
