import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import { defineTool, type Tool, type ToolCall, type ToolMessage, type ToolSchema } from "@mg/core";
import { ATTR, SPAN } from "./vocabulary.js";
import { traceRunToolCall } from "./tools.js";
import { RecordingSpan } from "./recording-span.test-helper.js";

const call: ToolCall = { id: "call-1", name: "weather", arguments: { city: "tokyo" } };

describe("traceRunToolCall", () => {
  it("records name, call id and arguments before running, and the result after", async () => {
    const root = new RecordingSpan("root");
    const message: ToolMessage = { role: "tool", toolCallId: "call-1", content: "sunny" };
    let startedBefore: RecordingSpan | undefined;
    const run = async () => {
      startedBefore = root.children[0];
      return message;
    };

    const result = await traceRunToolCall(root, run)([], call);

    expect(result).toBe(message);
    expect(startedBefore?.name).toBe(SPAN.tool);
    expect(startedBefore?.attributes).toEqual({
      [ATTR.op]: "tool",
      [ATTR.toolName]: "weather",
      [ATTR.toolCallId]: "call-1",
      [ATTR.toolArguments]: JSON.stringify(call.arguments),
    });

    const span = root.children[0];
    expect(span?.mergedAttributes[ATTR.toolResult]).toBe("sunny");
    expect(span?.endCalls).toEqual([undefined]);
  });

  it("ends the span with the error and rethrows it unchanged when run rejects", async () => {
    const root = new RecordingSpan("root");
    const error = new Error("boom");
    const run = async (): Promise<ToolMessage> => {
      throw error;
    };

    await expect(traceRunToolCall(root, run)([], call)).rejects.toBe(error);

    const span = root.children[0];
    expect(span?.endCalls).toEqual([error]);
  });

  it("uses core's runToolCall by default and records its result", async () => {
    const root = new RecordingSpan("root");
    const schema: ToolSchema = {
      "~standard": {
        version: 1,
        vendor: "mg-test",
        validate: (value: unknown): StandardSchemaV1.Result<unknown> => ({ value }),
        jsonSchema: {
          input: () => ({ type: "object" }),
          output: () => ({ type: "object" }),
        },
      },
    };
    const tool: Tool = {
      name: "weather",
      input: schema,
      execute: async (value) => JSON.stringify(value),
    };

    const message = await traceRunToolCall(root)([tool], call);

    expect(message).toEqual({
      role: "tool",
      toolCallId: "call-1",
      content: JSON.stringify(call.arguments),
    });

    const span = root.children[0];
    expect(span?.mergedAttributes[ATTR.toolResult]).toBe(JSON.stringify(call.arguments));
    expect(span?.endCalls).toEqual([undefined]);
  });
});
