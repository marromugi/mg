import { describe, expect, expectTypeOf, test } from "vitest";
import { ProviderError, ToolArgumentsError } from "./errors.js";
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemMessage,
  ToolDefinition,
  ToolMessage,
  UserMessage,
} from "./types.js";

const citySchema = {
  "~standard": {
    version: 1,
    vendor: "mg-test",
    jsonSchema: {
      input: () => ({
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      }),
      output: () => ({ type: "string" }),
    },
  },
} as const;

describe("ToolDefinition", () => {
  test("accepts a schema exposing a JSON Schema converter", () => {
    const weather = {
      name: "weather",
      description: "Looks up the weather",
      input: citySchema,
    } satisfies ToolDefinition;

    expectTypeOf(weather).toExtend<ToolDefinition>();
    expectTypeOf(weather.input).toExtend<typeof citySchema>();
  });
});

describe("Message", () => {
  test("discriminates on role", () => {
    expectTypeOf<Extract<Message, { role: "system" }>>().toEqualTypeOf<SystemMessage>();
    expectTypeOf<Extract<Message, { role: "user" }>>().toEqualTypeOf<UserMessage>();
    expectTypeOf<Extract<Message, { role: "assistant" }>>().toEqualTypeOf<AssistantMessage>();
    expectTypeOf<Extract<Message, { role: "tool" }>>().toEqualTypeOf<ToolMessage>();
  });

  test("narrows in a conditional", () => {
    const message: Message = { role: "tool", toolCallId: "call-1", content: "24" };

    if (message.role === "tool") {
      expectTypeOf(message).toEqualTypeOf<ToolMessage>();
      expect(message.toolCallId).toBe("call-1");
    }
  });
});

describe("StreamEvent", () => {
  test("discriminates on type", () => {
    expectTypeOf<Extract<StreamEvent, { type: "text-delta" }>>().toEqualTypeOf<{
      type: "text-delta";
      delta: string;
    }>();
    expectTypeOf<Extract<StreamEvent, { type: "tool-call" }>>().toHaveProperty("toolCall");
    expectTypeOf<Extract<StreamEvent, { type: "finish" }>>().toHaveProperty("finishReason");
  });

  test("narrows in a conditional", () => {
    const event: StreamEvent = { type: "text-delta", delta: "hi" };

    if (event.type === "text-delta") {
      expect(event.delta).toBe("hi");
    }
  });
});

describe("ProviderError", () => {
  test("carries the status and body", () => {
    const error = new ProviderError("x", 500, "body");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ProviderError");
    expect(error.message).toBe("x");
    expect(error.status).toBe(500);
    expect(error.body).toBe("body");
  });
});

describe("ToolArgumentsError", () => {
  test("carries the tool call it came from", () => {
    const error = new ToolArgumentsError("call-1", "weather", "{ not json");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ToolArgumentsError");
    expect(error.toolCallId).toBe("call-1");
    expect(error.toolName).toBe("weather");
    expect(error.raw).toBe("{ not json");
  });
});
