import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import { describe, expect, expectTypeOf, test } from "vitest";
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
      input: (_options: StandardJSONSchemaV1.Options) => ({
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      }),
      output: (_options: StandardJSONSchemaV1.Options) => ({
        type: "string",
      }),
    },
  },
} as const satisfies StandardJSONSchemaV1;

describe("ToolDefinition", () => {
  test("accepts a schema exposing a JSON Schema converter", () => {
    const weather = {
      name: "weather",
      description: "Looks up the weather",
      input: citySchema,
    } satisfies ToolDefinition;

    expect(
      weather.input["~standard"].jsonSchema.input({
        target: "draft-2020-12",
      }),
    ).toEqual({
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    });
  });

  test("rejects a schema without a JSON Schema converter", () => {
    // @ts-expect-error input must expose ~standard.jsonSchema
    ({ name: "weather", input: {} }) satisfies ToolDefinition;

    const withoutJsonSchema = {
      name: "weather",
      input: { "~standard": { version: 1, vendor: "mg-test" } },
    };
    // @ts-expect-error input must expose ~standard.jsonSchema
    withoutJsonSchema satisfies ToolDefinition;

    expect(true).toBe(true);
  });
});

describe("Message", () => {
  test("discriminates on role", () => {
    expectTypeOf<
      Extract<Message, { role: "system" }>
    >().toEqualTypeOf<SystemMessage>();
    expectTypeOf<
      Extract<Message, { role: "user" }>
    >().toEqualTypeOf<UserMessage>();
    expectTypeOf<
      Extract<Message, { role: "assistant" }>
    >().toEqualTypeOf<AssistantMessage>();
    expectTypeOf<
      Extract<Message, { role: "tool" }>
    >().toEqualTypeOf<ToolMessage>();
  });

  test("narrows in a conditional", () => {
    const describeMessage = (message: Message): string => {
      switch (message.role) {
        case "system":
          expectTypeOf(message).toEqualTypeOf<SystemMessage>();
          return `system:${message.content}`;
        case "user":
          expectTypeOf(message).toEqualTypeOf<UserMessage>();
          return `user:${message.content}`;
        case "assistant":
          expectTypeOf(message).toEqualTypeOf<AssistantMessage>();
          return `assistant:${message.parts.length}`;
        case "tool":
          expectTypeOf(message).toEqualTypeOf<ToolMessage>();
          return `tool:${message.toolCallId}`;
      }
    };

    expect(
      describeMessage({ role: "system", content: "be brief" }),
    ).toBe("system:be brief");
    expect(describeMessage({ role: "user", content: "weather?" })).toBe(
      "user:weather?",
    );
    expect(
      describeMessage({
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            id: "call-1",
            name: "weather",
            arguments: { city: "Tokyo" },
          },
        ],
      }),
    ).toBe("assistant:1");
    expect(
      describeMessage({
        role: "tool",
        toolCallId: "call-1",
        content: "24",
      }),
    ).toBe("tool:call-1");
  });
});

describe("StreamEvent", () => {
  test("discriminates on type", () => {
    expectTypeOf<
      Extract<StreamEvent, { type: "text-delta" }>
    >().toEqualTypeOf<{
      type: "text-delta";
      delta: string;
    }>();
    expectTypeOf<
      Extract<StreamEvent, { type: "tool-call" }>
    >().toHaveProperty("toolCall");
    expectTypeOf<
      Extract<StreamEvent, { type: "finish" }>
    >().toHaveProperty("finishReason");
  });

  test("narrows in a conditional", () => {
    const describeEvent = (event: StreamEvent): string => {
      switch (event.type) {
        case "text-delta":
          expectTypeOf(event).toEqualTypeOf<
            Extract<StreamEvent, { type: "text-delta" }>
          >();
          return `text:${event.delta}`;
        case "tool-call":
          expectTypeOf(event).toEqualTypeOf<
            Extract<StreamEvent, { type: "tool-call" }>
          >();
          return `call:${event.toolCall.name}`;
        case "finish":
          expectTypeOf(event).toEqualTypeOf<
            Extract<StreamEvent, { type: "finish" }>
          >();
          return `finish:${event.finishReason}:${event.usage?.outputTokens ?? 0}`;
      }
    };

    expect(describeEvent({ type: "text-delta", delta: "hi" })).toBe(
      "text:hi",
    );
    expect(
      describeEvent({
        type: "tool-call",
        toolCall: {
          id: "call-1",
          name: "weather",
          arguments: { city: "Tokyo" },
        },
      }),
    ).toBe("call:weather");
    expect(
      describeEvent({
        type: "finish",
        finishReason: "tool_calls",
        usage: { inputTokens: 12, outputTokens: 34 },
      }),
    ).toBe("finish:tool_calls:34");
  });
});
