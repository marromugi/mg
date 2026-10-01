import { OpenRouterHttpError } from "./http-error.js";
import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import { describe, expect, test } from "vitest";
import {
  ProviderResponseError,
  ProviderUnsupportedError,
  ToolArgumentsError,
  ToolSchemaError,
} from "../errors.js";
import type {
  FinishReason,
  GenerateRequest,
  Message,
  ToolChoice,
  ToolDefinition,
} from "../types.js";
import { textOf, toolCallsOf } from "../parts.js";
import {
  fromOpenRouterResponse,
  toOpenRouterRequest,
} from "./convert.js";

const sequentialIds = (): (() => string) => {
  let count = 0;
  return () => `u${++count}`;
};

const orCarry = (id: string) => ({
  provider: "openrouter",
  data: { id },
});

const requestBody = (request: GenerateRequest, stream: boolean) =>
  toOpenRouterRequest(request, stream).body;

const responseOf = (body: unknown) =>
  fromOpenRouterResponse(body, sequentialIds());

const weatherCall = (
  id: string,
  carry?: { provider: string; data: unknown },
): Message => ({
  role: "assistant",
  parts: [
    {
      type: "tool-call",
      id,
      name: "weather",
      arguments: { city: "Tokyo" },
      ...(carry !== undefined && { carry }),
    },
  ],
});

const sunnyResult = (id: string): Message => ({
  role: "tool",
  toolCallId: id,
  content: "Sunny",
});

type SentMessage = {
  tool_calls?: { id: string }[];
  tool_call_id?: string;
};

const sentIds = (request: GenerateRequest): string[] =>
  (
    requestBody(request, false) as { messages: SentMessage[] }
  ).messages.flatMap((message) => [
    ...(message.tool_calls ?? []).map((call) => call.id),
    ...(message.tool_call_id === undefined
      ? []
      : [message.tool_call_id]),
  ]);

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
    expect(requestBody(request(), false)).toMatchObject({
      model: "openai/gpt-4o",
      stream: false,
    });
    expect(requestBody(request(), true)).toMatchObject({
      stream: true,
    });
  });

  test("asks for the usage only when the answer is streamed", () => {
    expect(requestBody(request(), true)).toMatchObject({
      stream_options: { include_usage: true },
    });
    expect(requestBody(request(), false)).not.toHaveProperty(
      "stream_options",
    );
  });

  test("maps a system message", () => {
    const body = requestBody(
      request({ messages: [{ role: "system", content: "be brief" }] }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([
      { role: "system", content: "be brief" },
    ]);
  });

  test("maps a user message", () => {
    const body = requestBody(
      request({ messages: [{ role: "user", content: "weather?" }] }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([
      { role: "user", content: "weather?" },
    ]);
  });

  test("maps an assistant message with tool calls", () => {
    const body = requestBody(
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
    const body = requestBody(
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
    const body = requestBody(
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
    const body = requestBody(
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
    const body = requestBody(
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
    const body = requestBody(
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

  test("sends reasoning for every assistant message when there is no user message", () => {
    const details = [
      {
        type: "reasoning.text",
        text: "thinking it through",
        id: "r1",
        format: "anthropic-claude-v1",
        index: 0,
      },
    ];
    const body = requestBody(
      request({
        messages: [
          { role: "system", content: "be brief" },
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
          {
            role: "assistant",
            parts: [
              { type: "reasoning", text: "still thinking" },
              { type: "text", text: "24 degrees" },
            ],
          },
        ],
      }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([
      { role: "system", content: "be brief" },
      {
        role: "assistant",
        content: "hi",
        reasoning_details: details,
      },
      {
        role: "assistant",
        content: "24 degrees",
        reasoning: "still thinking",
      },
    ]);
  });

  test("sends neither reasoning field when the assistant message has no reasoning", () => {
    const body = requestBody(
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

  test("sends the model's own id for a call and its result", () => {
    const ids = sentIds(
      request({
        messages: [
          { role: "user", content: "hi" },
          weatherCall("u1", orCarry("call_1")),
          sunnyResult("u1"),
          weatherCall("u2", undefined),
          sunnyResult("u2"),
        ],
      }),
    );

    expect(ids).toEqual(["call_1", "call_1", "u2", "u2"]);
  });

  test("sends the call's own id when its carry belongs to another provider", () => {
    const ids = sentIds(
      request({
        messages: [
          weatherCall("u1", { provider: "other", data: { id: "x" } }),
          sunnyResult("u1"),
        ],
      }),
    );

    expect(ids).toEqual(["u1", "u1"]);
  });

  test("sends own ids and reports them when calls share the model's id", () => {
    const built = toOpenRouterRequest(
      request({
        messages: [
          weatherCall("u1", orCarry("call_1")),
          sunnyResult("u1"),
          weatherCall("u2", orCarry("call_1")),
          sunnyResult("u2"),
          weatherCall("u3", orCarry("call_9")),
          sunnyResult("u3"),
        ],
      }),
      false,
    );

    expect(
      (built.body as { messages: SentMessage[] }).messages.map(
        (message) =>
          message.tool_calls?.[0]?.id ?? message.tool_call_id,
      ),
    ).toEqual(["u1", "u1", "u2", "u2", "call_9", "call_9"]);
    expect(built.omitted).toEqual([
      { kind: "outside-tool-call-id", toolCallIds: ["u1", "u2"] },
    ]);
  });

  test("rejects a tool message that matches no call", () => {
    let thrown: unknown;
    try {
      requestBody(
        request({
          messages: [
            { role: "user", content: "hi" },
            sunnyResult("u9"),
          ],
        }),
        false,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProviderUnsupportedError);
    expect((thrown as ProviderUnsupportedError).feature).toBe(
      "tool-message-without-call",
    );
  });

  test("maps tools through the schema's JSON Schema converter", () => {
    targets.length = 0;

    const body = requestBody(
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
      requestBody(request({ tools: [failingTool] }), false);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ToolSchemaError);
    const toolSchemaError = error as ToolSchemaError;
    expect(toolSchemaError.toolName).toBe("weather");
    expect(toolSchemaError.cause).toBe(failure);
  });

  test("omits tools when the request has none", () => {
    const body = requestBody(request(), false) as RequestBody;

    expect(Object.hasOwn(body, "tools")).toBe(false);
  });

  test("omits tools when the tool list is empty", () => {
    const body = requestBody(
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
    const body = requestBody(
      request({ toolChoice }),
      false,
    ) as RequestBody;

    expect(body.tool_choice).toEqual(expected);
  });

  test("omits the tool choice when the request has none", () => {
    const body = requestBody(request(), false) as RequestBody;

    expect(Object.hasOwn(body, "tool_choice")).toBe(false);
  });

  test("maps the temperature and the token limit when set", () => {
    const body = requestBody(
      request({ temperature: 0.2, maxTokens: 128 }),
      false,
    ) as RequestBody;

    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(128);
  });

  test("omits the temperature and the token limit when unset", () => {
    const body = requestBody(request(), false) as RequestBody;

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
    expect(responseOf(responseBody({ content: "24 degrees" }))).toEqual(
      {
        parts: [{ type: "text", text: "24 degrees" }],
        finishReason: "stop",
      },
    );
  });

  test("falls back to an empty string when the content is null", () => {
    expect(textOf(responseOf(responseBody({ content: null })))).toBe(
      "",
    );
  });

  test("maps the reasoning text before the text part", () => {
    const response = responseOf(
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
    const response = responseOf(
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
    const response = responseOf(
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
    const response = responseOf(
      responseBody({ content: "24 degrees" }),
    );

    expect(response.parts).toEqual([
      { type: "text", text: "24 degrees" },
    ]);
  });

  test("maps two tool calls", () => {
    const response = responseOf(
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
      { id: "u1", name: "weather", arguments: { city: "Tokyo" } },
      { id: "u2", name: "weather", arguments: { city: "Osaka" } },
    ]);
  });

  test("keeps a non-empty model id in the carry and none otherwise", () => {
    const response = responseOf(
      responseBody({
        content: null,
        tool_calls: [
          {
            id: "call_111332",
            type: "function",
            function: {
              name: "weather",
              arguments: '{"city":"Tokyo"}',
            },
          },
          {
            id: "",
            type: "function",
            function: { name: "weather", arguments: "{}" },
          },
        ],
      }),
    );

    expect(response.parts).toEqual([
      {
        type: "tool-call",
        id: "u1",
        name: "weather",
        arguments: { city: "Tokyo" },
        carry: orCarry("call_111332"),
      },
      { type: "tool-call", id: "u2", name: "weather", arguments: {} },
    ]);
    expect(Object.hasOwn(response.parts[1] ?? {}, "carry")).toBe(false);
  });

  test("emits the text part before the tool-call parts", () => {
    const response = responseOf(
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
        id: "u1",
        name: "weather",
        arguments: {},
        carry: orCarry("call-1"),
      },
      {
        type: "tool-call",
        id: "u2",
        name: "weather",
        arguments: {},
        carry: orCarry("call-2"),
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
    const response = responseOf({
      choices: [{ message: { content: "" }, finish_reason: raw }],
    });

    expect(response.finishReason).toBe(expected);
  });

  test("maps the usage when it is present", () => {
    const response = responseOf(
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
    const response = responseOf(responseBody({ content: "hi" }));

    expect(Object.hasOwn(response, "usage")).toBe(false);
  });

  const thrownBy = (body: unknown): unknown => {
    try {
      responseOf(body);
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
    expect(toolArgumentsError.toolCallId).toBe("u1");
    expect(toolArgumentsError.toolName).toBe("weather");
    expect(toolArgumentsError.raw).toBe("{ not json");
    expect(toolArgumentsError.cause).toBeInstanceOf(SyntaxError);
  });

  test.each([
    ["", "an empty string"],
    [" \n ", "only whitespace"],
  ])("reads tool call arguments of %j (%s) as no arguments", (raw) => {
    const response = responseOf(
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
      { id: "u1", name: "weather", arguments: {} },
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
    expect(toolArgumentsError.toolCallId).toBe("u1");
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
  ])("throws a ProviderResponseError for %s", (_label, body) => {
    const error = thrownBy(body);

    expect(error).toBeInstanceOf(ProviderResponseError);
    const providerError = error as ProviderResponseError;
    expect(providerError.messageWithoutServiceText).toBe(
      "OpenRouter response has no choices: (text from the service left out)",
    );
    const httpError = providerError.cause as OpenRouterHttpError;
    expect(httpError).toBeInstanceOf(OpenRouterHttpError);
    expect(httpError.status).toBe(200);
    expect(httpError.body).toBe(JSON.stringify(body));
  });
});
