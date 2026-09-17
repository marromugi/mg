import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import { describe, expect, test } from "vitest";
import {
  ProviderHttpError,
  ToolArgumentsError,
  ToolSchemaError,
} from "../errors.js";
import type {
  FinishReason,
  GenerateRequest,
  ToolChoice,
  ToolDefinition,
} from "../types.js";
import { textOf, toolCallsOf } from "../parts.js";
import {
  fromOpenRouterResponse,
  toOpenRouterRequest,
} from "./convert.js";

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
      output: (_options: StandardJSONSchemaV1.Options) => ({
        type: "string",
      }),
    },
  },
} as const satisfies StandardJSONSchemaV1;

const weatherTool: ToolDefinition = {
  name: "weather",
  description: "Looks up the weather",
  input: citySchema,
};

const request = (
  overrides: Partial<GenerateRequest> = {},
): GenerateRequest => ({
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

  test("asks for the usage only when the answer is streamed", () => {
    expect(toOpenRouterRequest(request(), true)).toMatchObject({
      stream_options: { include_usage: true },
    });
    expect(toOpenRouterRequest(request(), false)).not.toHaveProperty(
      "stream_options",
    );
  });

  test("maps a system message", () => {
    const body = toOpenRouterRequest(
      request({ messages: [{ role: "system", content: "be brief" }] }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([
      { role: "system", content: "be brief" },
    ]);
  });

  test("maps a user message", () => {
    const body = toOpenRouterRequest(
      request({ messages: [{ role: "user", content: "weather?" }] }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([
      { role: "user", content: "weather?" },
    ]);
  });

  test("maps an assistant message with tool calls", () => {
    const body = toOpenRouterRequest(
      request({
        messages: [
          {
            role: "assistant",
            parts: [
              {
                type: "tool-call",
                id: "call-1",
                name: "weather",
                arguments: { city: "Tokyo" },
              },
              {
                type: "tool-call",
                id: "call-2",
                name: "weather",
                arguments: { city: "Osaka" },
              },
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
            function: {
              name: "weather",
              arguments: '{"city":"Tokyo"}',
            },
          },
          {
            id: "call-2",
            type: "function",
            function: {
              name: "weather",
              arguments: '{"city":"Osaka"}',
            },
          },
        ],
      },
    ]);
  });

  test("omits tool_calls when the assistant message has none", () => {
    const body = toOpenRouterRequest(
      request({
        messages: [
          { role: "assistant", parts: [{ type: "text", text: "hi" }] },
        ],
      }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([
      { role: "assistant", content: "hi" },
    ]);
    expect(
      Object.hasOwn(
        (body.messages as Record<string, unknown>[])[0],
        "tool_calls",
      ),
    ).toBe(false);
  });

  test("does not send reasoning from a turn before the last user message", () => {
    const body = toOpenRouterRequest(
      request({
        messages: [
          {
            role: "assistant",
            parts: [
              { type: "reasoning", text: "thinking it through" },
              { type: "text", text: "hi" },
            ],
          },
          { role: "user", content: "and then?" },
        ],
      }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([
      { role: "assistant", content: "hi" },
      { role: "user", content: "and then?" },
    ]);
  });

  test("sends the reasoning text for the turn after the last user message", () => {
    const body = toOpenRouterRequest(
      request({
        messages: [
          { role: "user", content: "weather?" },
          {
            role: "assistant",
            parts: [
              { type: "reasoning", text: "thinking it through" },
              { type: "text", text: "hi" },
            ],
          },
        ],
      }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: "hi",
        reasoning: "thinking it through",
      },
    ]);
  });

  test("sends reasoning_details from an openrouter carry for the turn after the last user message", () => {
    const details = [
      {
        type: "reasoning.text",
        text: "thinking it through",
        id: "r1",
        format: "anthropic-claude-v1",
        index: 0,
      },
    ];
    const body = toOpenRouterRequest(
      request({
        messages: [
          { role: "user", content: "weather?" },
          {
            role: "assistant",
            parts: [
              {
                type: "reasoning",
                text: "thinking it through",
                carry: { provider: "openrouter", data: details },
              },
              { type: "text", text: "hi" },
            ],
          },
        ],
      }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: "hi",
        reasoning_details: details,
      },
    ]);
  });

  test("ignores a carry made by another connection and falls back to the reasoning text", () => {
    const body = toOpenRouterRequest(
      request({
        messages: [
          { role: "user", content: "weather?" },
          {
            role: "assistant",
            parts: [
              {
                type: "reasoning",
                text: "thinking it through",
                carry: { provider: "ollama", data: ["foreign"] },
              },
              { type: "text", text: "hi" },
            ],
          },
        ],
      }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: "hi",
        reasoning: "thinking it through",
      },
    ]);
  });

  test("sends neither reasoning field when the assistant message has no reasoning", () => {
    const body = toOpenRouterRequest(
      request({
        messages: [
          { role: "user", content: "weather?" },
          { role: "assistant", parts: [{ type: "text", text: "hi" }] },
        ],
      }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([
      { role: "user", content: "weather?" },
      { role: "assistant", content: "hi" },
    ]);
  });

  test("maps a tool message", () => {
    const body = toOpenRouterRequest(
      request({
        messages: [
          { role: "tool", toolCallId: "call-1", content: "24" },
        ],
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

  test("throws a ToolSchemaError when the schema converter throws", () => {
    const failure = new Error("unsupported target");
    const failingSchema = {
      "~standard": {
        version: 1,
        vendor: "mg-test",
        jsonSchema: {
          input: (_options: StandardJSONSchemaV1.Options) => {
            throw failure;
          },
          output: (_options: StandardJSONSchemaV1.Options) => ({
            type: "string",
          }),
        },
      },
    } as const satisfies StandardJSONSchemaV1;
    const failingTool: ToolDefinition = {
      name: "weather",
      input: failingSchema,
    };

    let error: unknown;
    try {
      toOpenRouterRequest(request({ tools: [failingTool] }), false);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ToolSchemaError);
    const toolSchemaError = error as ToolSchemaError;
    expect(toolSchemaError.toolName).toBe("weather");
    expect(toolSchemaError.cause).toBe(failure);
  });

  test("omits tools when the request has none", () => {
    const body = toOpenRouterRequest(request(), false) as RequestBody;

    expect(Object.hasOwn(body, "tools")).toBe(false);
  });

  test("omits tools when the tool list is empty", () => {
    const body = toOpenRouterRequest(
      request({ tools: [] }),
      false,
    ) as RequestBody;

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
    const body = toOpenRouterRequest(
      request({ toolChoice }),
      false,
    ) as RequestBody;

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
    expect(
      fromOpenRouterResponse(responseBody({ content: "24 degrees" })),
    ).toEqual({
      parts: [{ type: "text", text: "24 degrees" }],
      finishReason: "stop",
    });
  });

  test("falls back to an empty string when the content is null", () => {
    expect(
      textOf(fromOpenRouterResponse(responseBody({ content: null }))),
    ).toBe("");
  });

  test("maps the reasoning text before the text part", () => {
    const response = fromOpenRouterResponse(
      responseBody({
        content: "24 degrees",
        reasoning: "checking the forecast",
      }),
    );

    expect(response.parts).toEqual([
      { type: "reasoning", text: "checking the forecast" },
      { type: "text", text: "24 degrees" },
    ]);
  });

  test("attaches an openrouter carry when reasoning_details is present", () => {
    const details = [
      {
        type: "reasoning.text",
        text: "checking the forecast",
        id: "r1",
        format: "anthropic-claude-v1",
        index: 0,
      },
    ];
    const response = fromOpenRouterResponse(
      responseBody({
        content: "24 degrees",
        reasoning: "checking the forecast",
        reasoning_details: details,
      }),
    );

    expect(response.parts).toEqual([
      {
        type: "reasoning",
        text: "checking the forecast",
        carry: { provider: "openrouter", data: details },
      },
      { type: "text", text: "24 degrees" },
    ]);
  });

  test("yields a reasoning part with an empty text when only reasoning_details is present", () => {
    const details = [
      {
        type: "reasoning.encrypted",
        data: "opaque",
        id: "r1",
        format: "anthropic-claude-v1",
        index: 0,
      },
    ];
    const response = fromOpenRouterResponse(
      responseBody({
        content: "24 degrees",
        reasoning_details: details,
      }),
    );

    expect(response.parts).toEqual([
      {
        type: "reasoning",
        text: "",
        carry: { provider: "openrouter", data: details },
      },
      { type: "text", text: "24 degrees" },
    ]);
  });

  test("omits the reasoning part when neither reasoning nor reasoning_details is present", () => {
    const response = fromOpenRouterResponse(
      responseBody({ content: "24 degrees" }),
    );

    expect(response.parts).toEqual([
      { type: "text", text: "24 degrees" },
    ]);
  });

  test("maps two tool calls", () => {
    const response = fromOpenRouterResponse(
      responseBody({
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "weather",
              arguments: '{"city":"Tokyo"}',
            },
          },
          {
            id: "call-2",
            type: "function",
            function: {
              name: "weather",
              arguments: '{"city":"Osaka"}',
            },
          },
        ],
      }),
    );

    expect(toolCallsOf(response)).toEqual([
      { id: "call-1", name: "weather", arguments: { city: "Tokyo" } },
      { id: "call-2", name: "weather", arguments: { city: "Osaka" } },
    ]);
  });

  test("emits the text part before the tool-call parts", () => {
    const response = fromOpenRouterResponse(
      responseBody({
        content: "checking the weather",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "weather", arguments: "{}" },
          },
          {
            id: "call-2",
            type: "function",
            function: { name: "weather", arguments: "{}" },
          },
        ],
      }),
    );

    expect(response.parts).toEqual([
      { type: "text", text: "checking the weather" },
      {
        type: "tool-call",
        id: "call-1",
        name: "weather",
        arguments: {},
      },
      {
        type: "tool-call",
        id: "call-2",
        name: "weather",
        arguments: {},
      },
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

    expect(response.usage).toEqual({
      inputTokens: 12,
      outputTokens: 34,
    });
  });

  test("omits the usage when it is absent", () => {
    const response = fromOpenRouterResponse(
      responseBody({ content: "hi" }),
    );

    expect(Object.hasOwn(response, "usage")).toBe(false);
  });

  const thrownBy = (body: unknown): unknown => {
    try {
      fromOpenRouterResponse(body);
    } catch (error) {
      return error;
    }
    return undefined;
  };

  test("throws when tool call arguments are not JSON", () => {
    const error = thrownBy(
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

    expect(error).toBeInstanceOf(ToolArgumentsError);
    const toolArgumentsError = error as ToolArgumentsError;
    expect(toolArgumentsError.toolCallId).toBe("call-1");
    expect(toolArgumentsError.toolName).toBe("weather");
    expect(toolArgumentsError.raw).toBe("{ not json");
    expect(toolArgumentsError.cause).toBeInstanceOf(SyntaxError);
  });

  test.each([
    ["", "an empty string"],
    [" \n ", "only whitespace"],
  ])("reads tool call arguments of %j (%s) as no arguments", (raw) => {
    const response = fromOpenRouterResponse(
      responseBody({
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "weather", arguments: raw },
          },
        ],
      }),
    );

    expect(toolCallsOf(response)).toEqual([
      { id: "call-1", name: "weather", arguments: {} },
    ]);
  });

  test("throws when the tool call has no function", () => {
    const error = thrownBy(
      responseBody({
        content: null,
        tool_calls: [{ id: "call-1", type: "function" }],
      }),
    );

    expect(error).toBeInstanceOf(ToolArgumentsError);
    const toolArgumentsError = error as ToolArgumentsError;
    expect(toolArgumentsError.toolCallId).toBe("call-1");
    expect(toolArgumentsError.toolName).toBe("");
    expect(toolArgumentsError.raw).toBe("undefined");
    expect(toolArgumentsError.cause).toBeUndefined();
  });

  test("throws when tool call arguments are not a string", () => {
    const error = thrownBy(
      responseBody({
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "weather", arguments: { city: "Tokyo" } },
          },
        ],
      }),
    );

    expect(error).toBeInstanceOf(ToolArgumentsError);
    const toolArgumentsError = error as ToolArgumentsError;
    expect(toolArgumentsError.toolName).toBe("weather");
    expect(toolArgumentsError.raw).toBe("[object Object]");
    expect(toolArgumentsError.cause).toBeUndefined();
  });

  test.each<[string, unknown]>([
    ["a body that is not an object", "not an object"],
    ["a null body", null],
    ["a body without choices", { id: "gen-1" }],
    ["an empty choice list", { choices: [] }],
    [
      "an error envelope",
      { error: { code: 502, message: "Provider returned error" } },
    ],
    [
      "a choice without a message",
      { choices: [{ finish_reason: "stop" }] },
    ],
    [
      "a choice with a null message",
      { choices: [{ message: null, finish_reason: "stop" }] },
    ],
  ])("throws a ProviderHttpError for %s", (_label, body) => {
    const error = thrownBy(body);

    expect(error).toBeInstanceOf(ProviderHttpError);
    const providerError = error as ProviderHttpError;
    expect(providerError.message).toBe(
      "OpenRouter response has no choices",
    );
    expect(providerError.status).toBe(200);
    expect(providerError.body).toBe(JSON.stringify(body));
  });
});
