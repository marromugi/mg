import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, test, vi } from "vitest";
import type { ToolCall } from "../providers/types.js";
import { ToolInputError, ToolNotFoundError } from "./errors.js";
import { runToolCall } from "./run.js";
import type { Tool, ToolSchema } from "./types.js";

const stubSchema = (
  validate: (value: unknown) => StandardSchemaV1.Result<unknown> | Promise<StandardSchemaV1.Result<unknown>>,
): ToolSchema => ({
  "~standard": {
    version: 1,
    vendor: "mg-test",
    validate,
    jsonSchema: {
      input: () => ({ type: "object" }),
      output: () => ({ type: "object" }),
    },
  },
});

const upperCity = (value: unknown) => ({ value: { city: (value as { city: string }).city.toUpperCase() } });

const stubTool = (
  input: ToolSchema,
  execute: Tool["execute"] = async (value) => JSON.stringify(value),
): Tool => ({ name: "weather", input, execute: vi.fn(execute) });

const call: ToolCall = { id: "call-1", name: "weather", arguments: { city: "tokyo" } };

describe("runToolCall", () => {
  test("returns a tool message with the executed content", async () => {
    const tool = stubTool(stubSchema(upperCity), async () => "sunny");

    await expect(runToolCall([tool], call)).resolves.toEqual({
      role: "tool",
      toolCallId: "call-1",
      content: "sunny",
    });
  });

  test("passes the validated value to execute, not the raw arguments", async () => {
    const tool = stubTool(stubSchema(upperCity));

    const message = await runToolCall([tool], call);

    expect(tool.execute).toHaveBeenCalledWith({ city: "TOKYO" }, {});
    expect(message.content).toBe(JSON.stringify({ city: "TOKYO" }));
  });

  test("picks the tool whose name matches the call", async () => {
    const other: Tool = { ...stubTool(stubSchema(upperCity), async () => "other"), name: "clock" };
    const weather = stubTool(stubSchema(upperCity), async () => "weather");

    await expect(runToolCall([other, weather], call)).resolves.toMatchObject({ content: "weather" });
    expect(other.execute).not.toHaveBeenCalled();
  });

  test("throws ToolNotFoundError when no tool has the name", async () => {
    const tool = stubTool(stubSchema(upperCity));
    const unknown: ToolCall = { id: "call-2", name: "missing", arguments: {} };

    const error = await runToolCall([tool], unknown).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ToolNotFoundError);
    expect(error).toMatchObject({ toolCallId: "call-2", toolName: "missing" });
  });

  test("throws ToolInputError with the issues and skips execute", async () => {
    const issues = [{ message: "Expected string", path: ["city"] }];
    const tool = stubTool(stubSchema(() => ({ issues })));

    const error = await runToolCall([tool], call).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ToolInputError);
    expect(error).toMatchObject({ toolCallId: "call-1", toolName: "weather" });
    expect((error as ToolInputError).issues).toBe(issues);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  test("handles a validate that returns a promise", async () => {
    const tool = stubTool(stubSchema(async (value) => upperCity(value)));

    await expect(runToolCall([tool], call)).resolves.toMatchObject({
      content: JSON.stringify({ city: "TOKYO" }),
    });
    expect(tool.execute).toHaveBeenCalledWith({ city: "TOKYO" }, {});
  });

  test("throws ToolInputError when an async validate returns issues", async () => {
    const issues = [{ message: "Expected string" }];
    const tool = stubTool(stubSchema(async () => ({ issues })));

    const error = await runToolCall([tool], call).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ToolInputError);
    expect((error as ToolInputError).issues).toBe(issues);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  test("lets an error thrown by execute through unchanged", async () => {
    class CustomError extends Error {}
    const thrown = new CustomError("boom");
    const tool = stubTool(stubSchema(upperCity), async () => {
      throw thrown;
    });

    await expect(runToolCall([tool], call)).rejects.toBe(thrown);
  });

  test("passes the context signal to execute", async () => {
    const tool = stubTool(stubSchema(upperCity));
    const controller = new AbortController();

    await runToolCall([tool], call, { signal: controller.signal });

    expect(tool.execute).toHaveBeenCalledWith({ city: "TOKYO" }, { signal: controller.signal });
    expect(vi.mocked(tool.execute).mock.calls[0]?.[1].signal).toBe(controller.signal);
  });
});
