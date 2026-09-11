import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import { describe, expect, test } from "vitest";
import { ToolArgumentsError } from "../errors.js";
import type {
  FinishReason,
  GenerateRequest,
  ToolChoice,
  ToolDefinition,
} from "../types.js";
import { fromOpenRouterResponse, toOpenRouterRequest } from "./convert.js";

const cityJsonSchema = {
  type: "object",
  properties: { city: { type: "string" } },
  required: ["city"],
};

const targets: StandardJSONSchemaV1.Target[] = [];

const citySchema = {
  "~standard": {
    version: 1,
    vendor: "mg-test",
    jsonSchema: {
      input: (options: StandardJSONSchemaV1.Options) => {
        targets.push(options.target);
        return cityJsonSchema;
      },
      output: (_options: StandardJSONSchemaV1.Options) => ({ type: "string" }),
    },
  },
} as const satisfies StandardJSONSchemaV1;

const weatherTool: ToolDefinition = {
  name: "weather",
  description: "Looks up the weather",
  input: citySchema,
};

const request = (overrides: Partial<GenerateRequest> = {}): GenerateRequest => ({
  model: "openai/gpt-4o",
  messages: [{ role: "user", content: "weather?" }],
  ...overrides,
});

type RequestBody = Record<string, unknown>;

describe("toOpenRouterRequest", () => {
  test("maps the model and the stream flag", () => {
    expect(toOpenRouterRequest(request(), false)).toMatchObject({
      model: "openai/gpt-4o",
      stream: false,
    });
    expect(toOpenRouterRequest(request(), true)).toMatchObject({
      stream: true,
    });
  });

  test("maps a system message", () => {
    const body = toOpenRouterRequest(
      request({ messages: [{ role: "system", content: "be brief" }] }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([{ role: "system", content: "be brief" }]);
  });

  test("maps a user message", () => {
    const body = toOpenRouterRequest(
      request({ messages: [{ role: "user", content: "weather?" }] }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([{ role: "user", content: "weather?" }]);
  });

  test("maps an assistant message with tool calls", () => {
    const body = toOpenRouterRequest(
      request({
        messages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              { id: "call-1", name: "weather", arguments: { city: "Tokyo" } },
              { id: "call-2", name: "weather", arguments: { city: "Osaka" } },
            ],
          },
        ],
      }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "weather", arguments: '{"city":"Tokyo"}' },
          },
          {
            id: "call-2",
            type: "function",
            function: { name: "weather", arguments: '{"city":"Osaka"}' },
          },
        ],
      },
    ]);
  });

  test("omits tool_calls when the assistant message has none", () => {
    const withoutKey = toOpenRouterRequest(
      request({ messages: [{ role: "assistant", content: "hi" }] }),
      false,
    ) as RequestBody;
    const withEmptyList = toOpenRouterRequest(
      request({ messages: [{ role: "assistant", content: "hi", toolCalls: [] }] }),
      false,
    ) as RequestBody;

    expect(withoutKey.messages).toEqual([{ role: "assistant", content: "hi" }]);
    expect(withEmptyList.messages).toEqual([
      { role: "assistant", content: "hi" },
    ]);
    expect(
      Object.hasOwn(
        (withoutKey.messages as Record<string, unknown>[])[0]!,
        "tool_calls",
      ),
    ).toBe(false);
  });

  test("maps a tool message", () => {
    const body = toOpenRouterRequest(
      request({
        messages: [{ role: "tool", toolCallId: "call-1", content: "24" }],
      }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([
      { role: "tool", tool_call_id: "call-1", content: "24" },
    ]);
  });

  test("maps tools through the schema's JSON Schema converter", () => {
    targets.length = 0;

    const body = toOpenRouterRequest(
      request({ tools: [weatherTool] }),
      false,
    ) as RequestBody;

    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "weather",
          description: "Looks up the weather",
          parameters: cityJsonSchema,
        },
      },
    ]);
    expect(targets).toEqual(["draft-07"]);
  });

  test("omits tools when the request has none", () => {
    const body = toOpenRouterRequest(request(), false) as RequestBody;

    expect(Object.hasOwn(body, "tools")).toBe(false);
  });

  test.each<[ToolChoice, unknown]>([
    ["auto", "auto"],
    ["none", "none"],
    ["required", "required"],
    [
      { type: "tool", name: "weather" },
      { type: "function", function: { name: "weather" } },
    ],
  ])("maps the tool choice %j", (toolChoice, expected) => {
    const body = toOpenRouterRequest(request({ toolChoice }), false) as RequestBody;

    expect(body.tool_choice).toEqual(expected);
  });

  test("omits the tool choice when the request has none", () => {
    const body = toOpenRouterRequest(request(), false) as RequestBody;

    expect(Object.hasOwn(body, "tool_choice")).toBe(false);
  });

  test("maps the temperature and the token limit when set", () => {
    const body = toOpenRouterRequest(
      request({ temperature: 0.2, maxTokens: 128 }),
      false,
    ) as RequestBody;

    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(128);
  });

  test("omits the temperature and the token limit when unset", () => {
    const body = toOpenRouterRequest(request(), false) as RequestBody;

    expect(Object.hasOwn(body, "temperature")).toBe(false);
    expect(Object.hasOwn(body, "max_tokens")).toBe(false);
  });
});

const responseBody = (
  message: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  choices: [{ message, finish_reason: "stop" }],
  ...extra,
});

describe("fromOpenRouterResponse", () => {
  test("maps a text-only answer", () => {
    expect(fromOpenRouterResponse(responseBody({ content: "24 degrees" }))).toEqual(
      {
        content: "24 degrees",
        toolCalls: [],
        finishReason: "stop",
      },
    );
  });

  test("falls back to an empty string when the content is null", () => {
    expect(fromOpenRouterResponse(responseBody({ content: null })).content).toBe(
      "",
    );
  });

  test("maps two tool calls", () => {
    const response = fromOpenRouterResponse(
      responseBody({
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "weather", arguments: '{"city":"Tokyo"}' },
          },
          {
            id: "call-2",
            type: "function",
            function: { name: "weather", arguments: '{"city":"Osaka"}' },
          },
        ],
      }),
    );

    expect(response.toolCalls).toEqual([
      { id: "call-1", name: "weather", arguments: { city: "Tokyo" } },
      { id: "call-2", name: "weather", arguments: { city: "Osaka" } },
    ]);
  });

  test.each<[string | null, FinishReason]>([
    ["stop", "stop"],
    ["tool_calls", "tool_calls"],
    ["length", "length"],
    ["content_filter", "other"],
    ["error", "other"],
    [null, "other"],
  ])("maps the finish reason %j", (raw, expected) => {
    const response = fromOpenRouterResponse({
      choices: [{ message: { content: "" }, finish_reason: raw }],
    });

    expect(response.finishReason).toBe(expected);
  });

  test("maps the usage when it is present", () => {
    const response = fromOpenRouterResponse(
      responseBody(
        { content: "hi" },
        { usage: { prompt_tokens: 12, completion_tokens: 34 } },
      ),
    );

    expect(response.usage).toEqual({ inputTokens: 12, outputTokens: 34 });
  });

  test("omits the usage when it is absent", () => {
    const response = fromOpenRouterResponse(responseBody({ content: "hi" }));

    expect(Object.hasOwn(response, "usage")).toBe(false);
  });

  test("throws when tool call arguments are not JSON", () => {
    const call = () =>
      fromOpenRouterResponse(
        responseBody({
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "weather", arguments: "{ not json" },
            },
          ],
        }),
      );

    expect(call).toThrow(ToolArgumentsError);
    try {
      call();
    } catch (error) {
      const toolArgumentsError = error as ToolArgumentsError;
      expect(toolArgumentsError.toolCallId).toBe("call-1");
      expect(toolArgumentsError.toolName).toBe("weather");
      expect(toolArgumentsError.raw).toBe("{ not json");
    }
  });
});
