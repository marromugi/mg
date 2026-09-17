import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import { describe, expect, test } from "vitest";
import {
  ProviderHttpError,
  ProviderUnsupportedError,
  ToolArgumentsError,
  ToolSchemaError,
} from "../errors.js";
import type {
  FinishReason,
  GenerateRequest,
  ToolChoice,
  ToolDefinition,
} from "../types.js";
import {
  fromOllamaResponse,
  toFinishReason,
  toOllamaRequest,
  toToolCall,
  toUsage,
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
  model: "llama3",
  messages: [{ role: "user", content: "weather?" }],
  ...overrides,
});

type RequestBody = Record<string, unknown>;

describe("toOllamaRequest", () => {
  test("maps the model and the stream flag", () => {
    expect(toOllamaRequest(request(), false)).toMatchObject({
      model: "llama3",
      stream: false,
    });
    expect(toOllamaRequest(request(), true)).toMatchObject({
      stream: true,
    });
  });

  test("maps a system message", () => {
    const body = toOllamaRequest(
      request({ messages: [{ role: "system", content: "be brief" }] }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([
      { role: "system", content: "be brief" },
    ]);
  });

  test("maps a user message", () => {
    const body = toOllamaRequest(
      request({ messages: [{ role: "user", content: "weather?" }] }),
      false,
    ) as RequestBody;

    expect(body.messages).toEqual([
      { role: "user", content: "weather?" },
    ]);
  });

  test("maps an assistant message with tool calls, keeping arguments as an object", () => {
    const body = toOllamaRequest(
      request({
        messages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "call-1",
                name: "weather",
                arguments: { city: "Tokyo" },
              },
              {
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
            function: { name: "weather", arguments: { city: "Tokyo" } },
          },
          {
            id: "call-2",
            function: { name: "weather", arguments: { city: "Osaka" } },
          },
        ],
      },
    ]);
  });

  test("omits tool_calls when the assistant message has none", () => {
    const withoutKey = toOllamaRequest(
      request({ messages: [{ role: "assistant", content: "hi" }] }),
      false,
    ) as RequestBody;
    const withEmptyList = toOllamaRequest(
      request({
        messages: [{ role: "assistant", content: "hi", toolCalls: [] }],
      }),
      false,
    ) as RequestBody;

    expect(withoutKey.messages).toEqual([
      { role: "assistant", content: "hi" },
    ]);
    expect(withEmptyList.messages).toEqual([
      { role: "assistant", content: "hi" },
    ]);
    expect(
      Object.hasOwn(
        (withoutKey.messages as Record<string, unknown>[])[0],
        "tool_calls",
      ),
    ).toBe(false);
  });

  test("maps a tool message by resolving its tool name from an earlier assistant tool call", () => {
    const body = toOllamaRequest(
      request({
        messages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              { id: "call-1", name: "weather", arguments: {} },
            ],
          },
          { role: "tool", toolCallId: "call-1", content: "24" },
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
            function: { name: "weather", arguments: {} },
          },
        ],
      },
      { role: "tool", tool_name: "weather", content: "24" },
    ]);
  });

  test("throws a ProviderUnsupportedError when a tool message has no matching assistant tool call", () => {
    let error: unknown;
    try {
      toOllamaRequest(
        request({
          messages: [
            { role: "tool", toolCallId: "call-missing", content: "24" },
          ],
        }),
        false,
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ProviderUnsupportedError);
    const unsupportedError = error as ProviderUnsupportedError;
    expect(unsupportedError.feature).toBe("tool-message-without-call");
    expect(unsupportedError.message).toContain("Ollama");
  });

  test("maps tools through the schema's JSON Schema converter", () => {
    targets.length = 0;

    const body = toOllamaRequest(
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
      toOllamaRequest(request({ tools: [failingTool] }), false);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ToolSchemaError);
    const toolSchemaError = error as ToolSchemaError;
    expect(toolSchemaError.toolName).toBe("weather");
    expect(toolSchemaError.cause).toBe(failure);
  });

  test("omits tools when the request has none", () => {
    const body = toOllamaRequest(request(), false) as RequestBody;

    expect(Object.hasOwn(body, "tools")).toBe(false);
  });

  test("omits tools when the tool list is empty", () => {
    const body = toOllamaRequest(
      request({ tools: [] }),
      false,
    ) as RequestBody;

    expect(Object.hasOwn(body, "tools")).toBe(false);
  });

  test.each<ToolChoice | undefined>([undefined, "auto"])(
    "sends the tool list as-is for tool choice %j",
    (toolChoice) => {
      const body = toOllamaRequest(
        request({ tools: [weatherTool], toolChoice }),
        false,
      ) as RequestBody;

      expect(Object.hasOwn(body, "tools")).toBe(true);
    },
  );

  test("omits tools when the tool choice is none, even when tools are given", () => {
    const body = toOllamaRequest(
      request({ tools: [weatherTool], toolChoice: "none" }),
      false,
    ) as RequestBody;

    expect(Object.hasOwn(body, "tools")).toBe(false);
  });

  test.each<ToolChoice>([
    "required",
    { type: "tool", name: "weather" },
  ])(
    "throws a ProviderUnsupportedError for the tool choice %j",
    (toolChoice) => {
      let error: unknown;
      try {
        toOllamaRequest(request({ toolChoice }), false);
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(ProviderUnsupportedError);
      const unsupportedError = error as ProviderUnsupportedError;
      expect(unsupportedError.feature).toBe("tool-choice");
      expect(unsupportedError.message).toContain("Ollama");
    },
  );

  test("maps the temperature and the token limit into options", () => {
    const body = toOllamaRequest(
      request({ temperature: 0.2, maxTokens: 128 }),
      false,
    ) as RequestBody;

    expect(body.options).toEqual({
      temperature: 0.2,
      num_predict: 128,
    });
  });

  test("maps the ollama-specific options", () => {
    const body = toOllamaRequest(request(), false, {
      think: true,
      keepAlive: "5m",
      numCtx: 4096,
    }) as RequestBody;

    expect(body.think).toBe(true);
    expect(body.keep_alive).toBe("5m");
    expect(body.options).toEqual({ num_ctx: 4096 });
  });

  test("omits options, think and keep_alive when unset", () => {
    const body = toOllamaRequest(request(), false) as RequestBody;

    expect(Object.hasOwn(body, "options")).toBe(false);
    expect(Object.hasOwn(body, "think")).toBe(false);
    expect(Object.hasOwn(body, "keep_alive")).toBe(false);
  });
});

describe("toFinishReason", () => {
  test.each<[string | null | undefined, boolean, FinishReason]>([
    ["stop", false, "stop"],
    ["length", false, "length"],
    ["load", false, "other"],
    [null, false, "other"],
    [undefined, false, "other"],
    ["stop", true, "tool_calls"],
    ["length", true, "tool_calls"],
  ])(
    "maps done_reason %j with tool calls present: %j",
    (doneReason, hasToolCalls, expected) => {
      expect(toFinishReason(doneReason, hasToolCalls)).toBe(expected);
    },
  );
});

describe("toUsage", () => {
  test("maps the usage when both counts are numbers", () => {
    expect(toUsage({ prompt_eval_count: 12, eval_count: 34 })).toEqual({
      inputTokens: 12,
      outputTokens: 34,
    });
  });

  test.each<[Record<string, unknown>, string]>([
    [{ eval_count: 34 }, "missing prompt_eval_count"],
    [{ prompt_eval_count: 12 }, "missing eval_count"],
    [{}, "missing both counts"],
  ])("returns undefined when %s", (body) => {
    expect(toUsage(body)).toBeUndefined();
  });
});

describe("toToolCall", () => {
  test("keeps the given id", () => {
    expect(
      toToolCall(
        { id: "call-1", function: { name: "weather", arguments: {} } },
        0,
      ),
    ).toEqual({ id: "call-1", name: "weather", arguments: {} });
  });

  test("falls back to call_<index> when the id is missing", () => {
    expect(
      toToolCall({ function: { name: "weather", arguments: {} } }, 2),
    ).toEqual({ id: "call_2", name: "weather", arguments: {} });
  });

  test("throws a ToolArgumentsError when arguments are not an object", () => {
    let error: unknown;
    try {
      toToolCall(
        {
          id: "call-1",
          function: { name: "weather", arguments: "Tokyo" },
        },
        0,
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ToolArgumentsError);
    const toolArgumentsError = error as ToolArgumentsError;
    expect(toolArgumentsError.toolCallId).toBe("call-1");
    expect(toolArgumentsError.toolName).toBe("weather");
    expect(toolArgumentsError.raw).toBe("Tokyo");
  });

  test("throws a ToolArgumentsError when arguments are null", () => {
    let error: unknown;
    try {
      toToolCall(
        {
          id: "call-1",
          function: { name: "weather", arguments: null },
        },
        0,
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ToolArgumentsError);
    const toolArgumentsError = error as ToolArgumentsError;
    expect(toolArgumentsError.raw).toBe("null");
  });
});

const responseBody = (
  message: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  message,
  done: true,
  done_reason: "stop",
  ...extra,
});

describe("fromOllamaResponse", () => {
  test("maps a text-only answer", () => {
    expect(
      fromOllamaResponse(responseBody({ content: "24 degrees" })),
    ).toEqual({
      content: "24 degrees",
      toolCalls: [],
      finishReason: "stop",
    });
  });

  test("falls back to an empty string when the content is missing", () => {
    expect(fromOllamaResponse(responseBody({})).content).toBe("");
  });

  test("ignores the model's thinking text", () => {
    const response = fromOllamaResponse(
      responseBody({ content: "24 degrees", thinking: "let me think" }),
    );

    expect(response).not.toHaveProperty("thinking");
    expect(response.content).toBe("24 degrees");
  });

  test("maps two tool calls, keeping arguments as objects", () => {
    const response = fromOllamaResponse(
      responseBody({
        content: "",
        tool_calls: [
          {
            id: "call-1",
            function: { name: "weather", arguments: { city: "Tokyo" } },
          },
          {
            id: "call-2",
            function: { name: "weather", arguments: { city: "Osaka" } },
          },
        ],
      }),
    );

    expect(response.toolCalls).toEqual([
      { id: "call-1", name: "weather", arguments: { city: "Tokyo" } },
      { id: "call-2", name: "weather", arguments: { city: "Osaka" } },
    ]);
  });

  test("returns tool_calls as the finish reason even though done_reason stays stop", () => {
    const response = fromOllamaResponse(
      responseBody(
        {
          content: "",
          tool_calls: [
            {
              id: "call-1",
              function: { name: "weather", arguments: {} },
            },
          ],
        },
        { done_reason: "stop" },
      ),
    );

    expect(response.finishReason).toBe("tool_calls");
  });

  test("falls back to call_<index> when a tool call has no id", () => {
    const response = fromOllamaResponse(
      responseBody({
        content: "",
        tool_calls: [{ function: { name: "weather", arguments: {} } }],
      }),
    );

    expect(response.toolCalls).toEqual([
      { id: "call_0", name: "weather", arguments: {} },
    ]);
  });

  test.each<[string | null | undefined, FinishReason]>([
    ["stop", "stop"],
    ["length", "length"],
    ["load", "other"],
    [null, "other"],
    [undefined, "other"],
  ])("maps the finish reason %j", (doneReason, expected) => {
    const response = fromOllamaResponse(
      responseBody({ content: "" }, { done_reason: doneReason }),
    );

    expect(response.finishReason).toBe(expected);
  });

  test("maps the usage when both counts are present", () => {
    const response = fromOllamaResponse(
      responseBody(
        { content: "hi" },
        { prompt_eval_count: 12, eval_count: 34 },
      ),
    );

    expect(response.usage).toEqual({
      inputTokens: 12,
      outputTokens: 34,
    });
  });

  test("omits the usage when it is absent", () => {
    const response = fromOllamaResponse(
      responseBody({ content: "hi" }),
    );

    expect(Object.hasOwn(response, "usage")).toBe(false);
  });

  test("omits the usage when only one count is present", () => {
    const response = fromOllamaResponse(
      responseBody({ content: "hi" }, { prompt_eval_count: 12 }),
    );

    expect(Object.hasOwn(response, "usage")).toBe(false);
  });

  test("throws when a tool call has non-object arguments", () => {
    let error: unknown;
    try {
      fromOllamaResponse(
        responseBody({
          content: "",
          tool_calls: [
            {
              id: "call-1",
              function: { name: "weather", arguments: "Tokyo" },
            },
          ],
        }),
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ToolArgumentsError);
  });

  const thrownBy = (body: unknown): unknown => {
    try {
      fromOllamaResponse(body);
    } catch (error) {
      return error;
    }
    return undefined;
  };

  test.each<[string, unknown]>([
    ["a body that is not an object", "not an object"],
    ["a null body", null],
    ["a body without a message", { done: true }],
    ["a body with a null message", { message: null }],
  ])("throws a ProviderHttpError for %s", (_description, body) => {
    const error = thrownBy(body);

    expect(error).toBeInstanceOf(ProviderHttpError);
    const httpError = error as ProviderHttpError;
    expect(httpError.message).toBe("Ollama response has no message");
    expect(httpError.status).toBe(200);
  });
});
