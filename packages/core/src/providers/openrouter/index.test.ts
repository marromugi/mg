import { OpenRouterHttpError } from "./http-error.js";
import { describe, expect, test } from "vitest";
import {
  ProviderRequestError,
  ProviderResponseError,
  ProviderUnsupportedError,
  ToolArgumentsError,
} from "../errors.js";
import { toolCallsOf } from "../parts.js";
import type { GenerateRequest, StreamEvent } from "../types.js";
import { createOpenRouterProvider } from "./index.js";

type Call = { url: string; init: RequestInit | undefined };

const stubFetch = (respond: () => Response) => {
  const calls: Call[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return respond();
  };
  return { fetchStub, calls };
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const request: GenerateRequest = {
  model: "openai/gpt-4o",
  messages: [{ role: "user", content: "weather?" }],
  temperature: 0.2,
};

const okBody = {
  choices: [
    { message: { content: "24 degrees" }, finish_reason: "stop" },
  ],
  usage: { prompt_tokens: 12, completion_tokens: 34 },
};

describe("createOpenRouterProvider", () => {
  test("exposes its own name", () => {
    const provider = createOpenRouterProvider({ apiKey: "test-key" });

    expect(provider.name).toBe("openrouter");
  });

  test("sends the expected URL, method, headers and body", async () => {
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      headers: {
        "HTTP-Referer": "https://example.test",
        "X-Title": "mg",
      },
      fetch: fetchStub,
    });

    await provider.generate(request);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(call.init?.method).toBe("POST");
    expect([...new Headers(call.init?.headers)].sort()).toEqual([
      ["authorization", "Bearer test-key"],
      ["content-type", "application/json"],
      ["http-referer", "https://example.test"],
      ["x-title", "mg"],
    ]);
    expect(JSON.parse(String(call.init?.body))).toEqual({
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "weather?" }],
      stream: false,
      temperature: 0.2,
    });
  });

  test("keeps the fixed headers when a caller header differs only in case", async () => {
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      headers: {
        authorization: "Bearer other",
        "content-type": "text/plain",
      },
      fetch: fetchStub,
    });

    await provider.generate(request);

    const headers = [...new Headers(calls[0].init?.headers)];
    expect(
      headers.filter(([name]) => name === "authorization"),
    ).toEqual([["authorization", "Bearer test-key"]]);
    expect(headers.filter(([name]) => name === "content-type")).toEqual(
      [["content-type", "application/json"]],
    );
  });

  test.each([
    ["https://proxy.test/v1", "https://proxy.test/v1/chat/completions"],
    [
      "https://example.test/v1/",
      "https://example.test/v1/chat/completions",
    ],
  ])("uses the given base URL %s", async (baseUrl, expected) => {
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      baseUrl,
      fetch: fetchStub,
    });

    await provider.generate(request);

    expect(calls[0].url).toBe(expected);
  });

  test("resolves the global fetch at call time", async () => {
    const provider = createOpenRouterProvider({ apiKey: "test-key" });
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const original = globalThis.fetch;

    globalThis.fetch = fetchStub;
    try {
      await provider.generate(request);
    } finally {
      globalThis.fetch = original;
    }

    expect(calls).toHaveLength(1);
  });

  test("returns the converted response", async () => {
    const { fetchStub } = stubFetch(() => jsonResponse(okBody));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    await expect(provider.generate(request)).resolves.toEqual({
      parts: [{ type: "text", text: "24 degrees" }],
      finishReason: "stop",
      usage: { inputTokens: 12, outputTokens: 34 },
    });
  });

  test("returns a reasoning part carrying the reasoning_details", async () => {
    const details = [
      {
        type: "reasoning.text",
        text: "checking the forecast",
        id: "r1",
        format: "anthropic-claude-v1",
        index: 0,
      },
    ];
    const { fetchStub } = stubFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: "24 degrees",
              reasoning: "checking the forecast",
              reasoning_details: details,
            },
            finish_reason: "stop",
          },
        ],
      }),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    await expect(provider.generate(request)).resolves.toMatchObject({
      parts: [
        {
          type: "reasoning",
          text: "checking the forecast",
          carry: { provider: "openrouter", data: details },
        },
        { type: "text", text: "24 degrees" },
      ],
    });
  });

  test("throws a ProviderRequestError carrying the status and the body in its cause", async () => {
    const { fetchStub } = stubFetch(
      () => new Response("rate limited", { status: 429 }),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await provider
      .generate(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderRequestError);
    const providerError = error as ProviderRequestError;
    expect(providerError.message).toBe(
      "OpenRouter request failed: 429: rate limited",
    );
    expect(providerError.messageWithoutServiceText).toBe(
      "OpenRouter request failed: 429: (text from the service left out)",
    );
    const httpError = providerError.cause as OpenRouterHttpError;
    expect(httpError).toBeInstanceOf(OpenRouterHttpError);
    expect(httpError.status).toBe(429);
    expect(httpError.body).toBe("rate limited");
  });

  test("throws a ProviderResponseError when a 2xx body is not JSON", async () => {
    const { fetchStub } = stubFetch(
      () =>
        new Response("<html>maintenance</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await provider
      .generate(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderResponseError);
    const providerError = error as ProviderResponseError;
    expect(providerError.messageWithoutServiceText).toBe(
      "OpenRouter response is not JSON: (text from the service left out)",
    );
    const httpError = providerError.cause as OpenRouterHttpError;
    expect(httpError.status).toBe(200);
    expect(httpError.body).toBe("<html>maintenance</html>");
  });

  test("throws a ProviderResponseError when the answer carries no choices", async () => {
    const body = {
      error: { code: 502, message: "Provider returned error" },
    };
    const { fetchStub } = stubFetch(() => jsonResponse(body));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await provider
      .generate(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderResponseError);
    const providerError = error as ProviderResponseError;
    expect(providerError.messageWithoutServiceText).toBe(
      "OpenRouter response has no choices: (text from the service left out)",
    );
    expect((providerError.cause as OpenRouterHttpError).body).toBe(
      JSON.stringify(body),
    );
  });

  test("throws a ProviderRequestError when the request cannot be sent", async () => {
    const failure = new TypeError("fetch failed", {
      cause: new Error("ENOTFOUND"),
    });
    const { fetchStub } = stubFetch(() => {
      throw failure;
    });
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await provider
      .generate(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderRequestError);
    const requestError = error as ProviderRequestError;
    expect(requestError.message).toBe(
      "OpenRouter request failed to send: fetch failed: ENOTFOUND",
    );
    expect(requestError.cause).toBe(failure);
  });

  test("throws a ProviderResponseError when the answer cannot be read", async () => {
    const failure = new Error("connection reset");
    const { fetchStub } = stubFetch(
      () =>
        new Response(
          new ReadableStream({
            start: (controller) => {
              controller.error(failure);
            },
          }),
          { status: 200 },
        ),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await provider
      .generate(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderResponseError);
    const responseError = error as ProviderResponseError;
    expect(responseError.message).toBe(
      "OpenRouter response body could not be read: connection reset",
    );
    expect(responseError.cause).toBe(failure);
  });

  test("passes an abort through without wrapping it", async () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    const { fetchStub } = stubFetch(() => {
      throw abort;
    });
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await provider
      .generate(request)
      .catch((caught: unknown) => caught);

    expect(error).toBe(abort);
  });

  test("throws a ToolArgumentsError when tool call arguments are not JSON", async () => {
    const { fetchStub } = stubFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "weather",
                    arguments: "{ not json",
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
      newToolCallId: () => "u1",
    });

    const error = await provider
      .generate(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ToolArgumentsError);
    const toolArgumentsError = error as ToolArgumentsError;
    expect(toolArgumentsError.toolCallId).toBe("u1");
    expect(toolArgumentsError.toolName).toBe("weather");
    expect(toolArgumentsError.raw).toBe("{ not json");
    expect(toolArgumentsError.cause).toBeInstanceOf(SyntaxError);
  });
});

const sseResponse = (payloads: string[]) =>
  new Response(
    `${payloads.map((payload) => `data: ${payload}\n\n`).join("")}data: [DONE]\n\n`,
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );

const erroringResponse = (failure: unknown, prelude?: string) => {
  let sent = false;
  return new Response(
    new ReadableStream({
      pull: (controller) => {
        if (prelude !== undefined && !sent) {
          sent = true;
          controller.enqueue(new TextEncoder().encode(prelude));
          return;
        }
        controller.error(failure);
      },
    }),
    { status: 200 },
  );
};

const collectStream = async (
  stream: AsyncIterable<StreamEvent>,
  into: StreamEvent[] = [],
) => {
  for await (const event of stream) into.push(event);
  return into;
};

describe("createOpenRouterProvider stream", () => {
  test("asks for a streamed answer with usage and yields the events", async () => {
    const { fetchStub, calls } = stubFetch(() =>
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "24" } }] }),
        JSON.stringify({
          choices: [{ delta: { content: " degrees" } }],
        }),
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: "stop" }],
        }),
        JSON.stringify({
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 34 },
        }),
      ]),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const events = await collectStream(provider.stream(request));

    expect(calls[0].url).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "weather?" }],
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
    });
    expect(events).toEqual([
      { type: "text-delta", delta: "24" },
      { type: "text-delta", delta: " degrees" },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 12, outputTokens: 34 },
      },
    ]);
  });

  test("sends nothing before the first event is asked for", async () => {
    const { fetchStub, calls } = stubFetch(() => sseResponse([]));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const stream = provider.stream(request);
    expect(calls).toHaveLength(0);

    await collectStream(stream);
    expect(calls).toHaveLength(1);
  });

  test("streams the reasoning and the carry ahead of the tool call", async () => {
    const detail = {
      type: "reasoning.text",
      text: "checking the forecast",
      id: "r1",
      format: "anthropic-claude-v1",
      index: 0,
    };
    const { fetchStub } = stubFetch(() =>
      sseResponse([
        JSON.stringify({
          choices: [{ delta: { reasoning_details: [detail] } }],
        }),
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-1",
                    type: "function",
                    function: { name: "weather", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: "tool_calls" }],
        }),
      ]),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
      newToolCallId: () => "u1",
    });

    await expect(
      collectStream(provider.stream(request)),
    ).resolves.toEqual([
      {
        type: "reasoning-delta",
        delta: "",
        carry: { provider: "openrouter", data: [detail] },
      },
      {
        type: "tool-call",
        toolCall: {
          id: "u1",
          name: "weather",
          arguments: {},
        },
        carry: { provider: "openrouter", data: { id: "call-1" } },
      },
      { type: "finish", finishReason: "tool_calls" },
    ]);
  });

  test("assembles a tool call carried by the stream", async () => {
    const { fetchStub } = stubFetch(() =>
      sseResponse([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-1",
                    type: "function",
                    function: { name: "weather", arguments: '{"city"' },
                  },
                ],
              },
            },
          ],
        }),
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: ':"Tokyo"}' } },
                ],
              },
            },
          ],
        }),
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: "tool_calls" }],
        }),
      ]),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
      newToolCallId: () => "u1",
    });

    await expect(
      collectStream(provider.stream(request)),
    ).resolves.toEqual([
      {
        type: "tool-call",
        toolCall: {
          id: "u1",
          name: "weather",
          arguments: { city: "Tokyo" },
        },
        carry: { provider: "openrouter", data: { id: "call-1" } },
      },
      { type: "finish", finishReason: "tool_calls" },
    ]);
  });

  test("puts omissions on the finish event when calls share the model's id", async () => {
    const { fetchStub } = stubFetch(() =>
      sseResponse([
        JSON.stringify({
          choices: [
            { delta: { content: "ok" }, finish_reason: "stop" },
          ],
        }),
      ]),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });
    const carry = { provider: "openrouter", data: { id: "call_1" } };
    const call = (id: string) => ({
      type: "tool-call" as const,
      id,
      name: "weather",
      arguments: {},
      carry,
    });

    await expect(
      collectStream(
        provider.stream({
          model: "openai/gpt-4o",
          messages: [
            { role: "assistant", parts: [call("u1"), call("u2")] },
            { role: "tool", toolCallId: "u1", content: "Sunny" },
            { role: "tool", toolCallId: "u2", content: "Rainy" },
          ],
        }),
      ),
    ).resolves.toEqual([
      { type: "text-delta", delta: "ok" },
      {
        type: "finish",
        finishReason: "stop",
        omitted: [
          { kind: "outside-tool-call-id", toolCallIds: ["u1", "u2"] },
        ],
      },
    ]);
  });

  test("puts omissions on the response of generate when calls share the model's id", async () => {
    const { fetchStub } = stubFetch(() => jsonResponse(okBody));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });
    const carry = { provider: "openrouter", data: { id: "call_1" } };
    const call = (id: string) => ({
      type: "tool-call" as const,
      id,
      name: "weather",
      arguments: {},
      carry,
    });

    const response = await provider.generate({
      model: "openai/gpt-4o",
      messages: [
        { role: "assistant", parts: [call("u1"), call("u2")] },
        { role: "tool", toolCallId: "u1", content: "Sunny" },
        { role: "tool", toolCallId: "u2", content: "Rainy" },
      ],
    });

    expect(response.omitted).toEqual([
      { kind: "outside-tool-call-id", toolCallIds: ["u1", "u2"] },
    ]);
  });

  test("leaves omitted out of the response when no model id is shared", async () => {
    const { fetchStub } = stubFetch(() => jsonResponse(okBody));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const response = await provider.generate({
      model: "openai/gpt-4o",
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              id: "u1",
              name: "weather",
              arguments: {},
              carry: { provider: "openrouter", data: { id: "call_1" } },
            },
          ],
        },
        { role: "tool", toolCallId: "u1", content: "Sunny" },
      ],
    });

    expect("omitted" in response).toBe(false);
  });

  test("does not fetch when a tool message has no call", async () => {
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await provider
      .generate({
        model: "openai/gpt-4o",
        messages: [
          { role: "user", content: "hi" },
          { role: "tool", toolCallId: "u9", content: "Sunny" },
        ],
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderUnsupportedError);
    expect((error as ProviderUnsupportedError).feature).toBe(
      "tool-message-without-call",
    );
    expect(calls).toHaveLength(0);
  });

  test("gives two calls different UUID ids when no generator is given", async () => {
    const toolCall = {
      id: "call_1",
      type: "function",
      function: { name: "weather", arguments: "{}" },
    };
    const { fetchStub } = stubFetch(() =>
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [toolCall, toolCall],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const response = await provider.generate(request);

    const [first, second] = toolCallsOf(response);
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(first?.id).toMatch(uuid);
    expect(second?.id).toMatch(uuid);
    expect(first?.id).not.toBe(second?.id);
  });

  test("throws a ProviderRequestError before any event on a non-2xx", async () => {
    const { fetchStub } = stubFetch(
      () => new Response("rate limited", { status: 429 }),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const events: StreamEvent[] = [];
    const error = await collectStream(
      provider.stream(request),
      events,
    ).catch((caught: unknown) => caught);

    expect(events).toEqual([]);
    expect(error).toBeInstanceOf(ProviderRequestError);
    const requestError = error as ProviderRequestError;
    expect(requestError.message).toBe(
      "OpenRouter request failed: 429: rate limited",
    );
    const httpError = requestError.cause as OpenRouterHttpError;
    expect(httpError.status).toBe(429);
    expect(httpError.body).toBe("rate limited");
  });

  test("throws a ProviderResponseError when the answer carries no body", async () => {
    const { fetchStub } = stubFetch(
      () => new Response(null, { status: 204 }),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await collectStream(provider.stream(request)).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderResponseError);
    expect((error as ProviderResponseError).message).toBe(
      "OpenRouter response has no body",
    );
  });

  test("throws a ProviderRequestError when the request cannot be sent", async () => {
    const failure = new TypeError("fetch failed");
    const { fetchStub } = stubFetch(() => {
      throw failure;
    });
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await collectStream(provider.stream(request)).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderRequestError);
    const requestError = error as ProviderRequestError;
    expect(requestError.message).toBe(
      "OpenRouter request failed to send: fetch failed",
    );
    expect(requestError.cause).toBe(failure);
  });

  test("throws a ProviderResponseError when the body fails midway", async () => {
    const failure = new Error("connection reset");
    const prelude = `data: ${JSON.stringify({
      choices: [{ delta: { content: "24" } }],
    })}\n\n`;
    const { fetchStub } = stubFetch(() =>
      erroringResponse(failure, prelude),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const events: StreamEvent[] = [];
    const error = await collectStream(
      provider.stream(request),
      events,
    ).catch((caught: unknown) => caught);

    expect(events).toEqual([{ type: "text-delta", delta: "24" }]);
    expect(error).toBeInstanceOf(ProviderResponseError);
    const responseError = error as ProviderResponseError;
    expect(responseError.message).toBe(
      "OpenRouter response body could not be read: connection reset",
    );
    expect(responseError.cause).toBe(failure);
  });

  test("passes an abort from the body through without wrapping it", async () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    const { fetchStub } = stubFetch(() => erroringResponse(abort));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await collectStream(provider.stream(request)).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBe(abort);
  });

  test("throws a ProviderResponseError when a streamed payload is not JSON", async () => {
    const { fetchStub } = stubFetch(() => sseResponse(["<html>"]));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await collectStream(provider.stream(request)).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderResponseError);
    const responseError = error as ProviderResponseError;
    expect(responseError.messageWithoutServiceText).toBe(
      "OpenRouter stream chunk is not JSON: (text from the service left out)",
    );
    const httpError = responseError.cause as OpenRouterHttpError;
    expect(httpError.status).toBe(200);
    expect(httpError.body).toBe("<html>");
  });
});

describe("createOpenRouterProvider halt", () => {
  const haltRequest: GenerateRequest = {
    model: "m",
    messages: [{ role: "user", content: "hi" }],
  };

  const stallingSseBody = (payloads: string[]) => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const payload of payloads) {
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        }
      },
      cancel() {
        cancelled = true;
      },
    });
    return {
      response: new Response(body, { status: 200 }),
      wasCancelled: () => cancelled,
    };
  };

  const neverClosingResponse = () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start() {},
      cancel() {
        cancelled = true;
      },
    });
    return {
      response: new Response(body, { status: 200 }),
      wasCancelled: () => cancelled,
    };
  };

  const closingResponse = (payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const flushMicrotasks = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 0));

  test("ends a streamed answer with a halted finish and cancels the body once the signal fires", async () => {
    const { response, wasCancelled } = stallingSseBody([
      JSON.stringify({ choices: [{ delta: { content: "Hel" } }] }),
    ]);
    const { fetchStub } = stubFetch(() => response);
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });
    const controller = new AbortController();

    const stream = provider.stream({
      ...haltRequest,
      halt: controller.signal,
    });
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    controller.abort();
    const rest = await collectStream({
      [Symbol.asyncIterator]: () => iterator,
    });

    expect([first.value, ...rest]).toEqual([
      { type: "text-delta", delta: "Hel" },
      { type: "finish", finishReason: "halted" },
    ]);
    expect(wasCancelled()).toBe(true);
  });

  test("drops a tool call that is still being assembled when the signal fires", async () => {
    const { response } = stallingSseBody([
      JSON.stringify({ choices: [{ delta: { content: "a" } }] }),
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call-1",
                  type: "function",
                  function: { name: "weather", arguments: '{"city"' },
                },
              ],
            },
          },
        ],
      }),
    ]);
    const { fetchStub } = stubFetch(() => response);
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });
    const controller = new AbortController();

    const stream = provider.stream({
      ...haltRequest,
      halt: controller.signal,
    });
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    controller.abort();
    const rest = await collectStream({
      [Symbol.asyncIterator]: () => iterator,
    });

    expect([first.value, ...rest]).toEqual([
      { type: "text-delta", delta: "a" },
      { type: "finish", finishReason: "halted" },
    ]);
  });

  test("returns an empty answer with a halted reason when the signal fires before the body closes", async () => {
    const { response, wasCancelled } = neverClosingResponse();
    const { fetchStub } = stubFetch(() => response);
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });
    const controller = new AbortController();

    const result = provider.generate({
      ...haltRequest,
      halt: controller.signal,
    });
    await flushMicrotasks();
    controller.abort();

    await expect(result).resolves.toEqual({
      parts: [],
      finishReason: "halted",
    });
    expect(wasCancelled()).toBe(true);
  });

  test("keeps the answer received before the signal fires", async () => {
    const { fetchStub } = stubFetch(() =>
      closingResponse({
        choices: [
          { message: { content: "ok" }, finish_reason: "stop" },
        ],
      }),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });
    const controller = new AbortController();

    const result = await provider.generate({
      ...haltRequest,
      halt: controller.signal,
    });
    controller.abort();

    expect(result).toEqual({
      parts: [{ type: "text", text: "ok" }],
      finishReason: "stop",
    });
  });

  test("sends nothing and answers halted when the signal already fired before the call", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchStub, calls } = stubFetch(() =>
      closingResponse({
        choices: [
          { message: { content: "ok" }, finish_reason: "stop" },
        ],
      }),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const streamEvents = await collectStream(
      provider.stream({ ...haltRequest, halt: controller.signal }),
    );
    const generateResult = await provider.generate({
      ...haltRequest,
      halt: controller.signal,
    });

    expect(streamEvents).toEqual([
      { type: "finish", finishReason: "halted" },
    ]);
    expect(generateResult).toEqual({
      parts: [],
      finishReason: "halted",
    });
    expect(calls).toHaveLength(0);
  });

  test("passes an unrelated abort through without wrapping it even when a halt signal is given", async () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    const { fetchStub } = stubFetch(() => {
      throw abort;
    });
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });
    const controller = new AbortController();

    const error = await provider
      .generate({ ...haltRequest, halt: controller.signal })
      .catch((caught: unknown) => caught);

    expect(error).toBe(abort);
  });

  test("carries no halt key in the request body", async () => {
    const { fetchStub, calls } = stubFetch(() =>
      closingResponse({
        choices: [
          { message: { content: "ok" }, finish_reason: "stop" },
        ],
      }),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });
    const controller = new AbortController();

    await provider.generate({
      ...haltRequest,
      halt: controller.signal,
    });

    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    });
  });
});

describe("createOpenRouterProvider with an authored user message", () => {
  const authoredOkBody = {
    choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
  };

  test("sends the same batch request body whether or not the user message carries an author", async () => {
    const { fetchStub: authoredFetch, calls: authoredCalls } =
      stubFetch(() => jsonResponse(authoredOkBody));
    const authoredProvider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: authoredFetch,
    });
    await authoredProvider.generate({
      model: "m",
      messages: [{ role: "user", author: "alice", content: "hi" }],
    });

    const { fetchStub: plainFetch, calls: plainCalls } = stubFetch(() =>
      jsonResponse(authoredOkBody),
    );
    const plainProvider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: plainFetch,
    });
    await plainProvider.generate({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
    });

    const authoredBody = JSON.parse(
      String(authoredCalls[0].init?.body),
    );
    expect(authoredBody.messages).toEqual([
      { role: "user", content: "hi" },
    ]);
    expect(authoredBody).toEqual(
      JSON.parse(String(plainCalls[0].init?.body)),
    );
  });

  test("sends the same streamed request body whether or not the user message carries an author", async () => {
    const streamPayload = [
      JSON.stringify({
        choices: [{ delta: { content: "ok" }, finish_reason: "stop" }],
      }),
    ];

    const { fetchStub: authoredFetch, calls: authoredCalls } =
      stubFetch(() => sseResponse(streamPayload));
    const authoredProvider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: authoredFetch,
    });
    await collectStream(
      authoredProvider.stream({
        model: "m",
        messages: [{ role: "user", author: "alice", content: "hi" }],
      }),
    );

    const { fetchStub: plainFetch, calls: plainCalls } = stubFetch(() =>
      sseResponse(streamPayload),
    );
    const plainProvider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: plainFetch,
    });
    await collectStream(
      plainProvider.stream({
        model: "m",
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    const authoredBody = JSON.parse(
      String(authoredCalls[0].init?.body),
    );
    expect(authoredBody.messages).toEqual([
      { role: "user", content: "hi" },
    ]);
    expect(authoredBody).toEqual(
      JSON.parse(String(plainCalls[0].init?.body)),
    );
  });

  test("keeps only role and content for a system message and two authored user messages", async () => {
    const { fetchStub, calls } = stubFetch(() =>
      jsonResponse(authoredOkBody),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    await provider.generate({
      model: "m",
      messages: [
        { role: "system", content: "s" },
        { role: "user", author: "alice", content: "hi" },
        { role: "user", author: "bob", content: "yo" },
      ],
    });

    expect(JSON.parse(String(calls[0].init?.body)).messages).toEqual([
      { role: "system", content: "s" },
      { role: "user", content: "hi" },
      { role: "user", content: "yo" },
    ]);
  });
});

describe("createOpenRouterProvider tool forcing", () => {
  test("declares that it can force a tool call without sending anything", () => {
    const { fetchStub, calls } = stubFetch(() => new Response("{}"));

    const provider = createOpenRouterProvider({
      apiKey: "k",
      fetch: fetchStub,
    });

    expect(provider.toolForcing).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("createOpenRouterProvider retry marks", () => {
  const withCode = (code: string) =>
    new TypeError("fetch failed", {
      cause: Object.assign(new Error("cause"), { code }),
    });
  const socketCut = new TypeError("terminated", {
    cause: Object.assign(new Error("other side closed"), {
      code: "UND_ERR_SOCKET",
    }),
  });
  const brokenGzip = new TypeError("terminated", {
    cause: Object.assign(new Error("incorrect header check"), {
      code: "Z_DATA_ERROR",
    }),
  });

  const providerFor = (respond: () => Response) =>
    createOpenRouterProvider({
      apiKey: "test-key",
      fetch: async () => respond(),
    });

  const failingBody = (error: unknown, status = 200, init = {}) =>
    new Response(
      new ReadableStream({
        pull: (controller) => {
          controller.error(error);
        },
      }),
      { status, ...init },
    );

  const generateError = (provider: {
    generate: (r: GenerateRequest) => Promise<unknown>;
  }) => provider.generate(request).catch((caught: unknown) => caught);

  const streamError = (provider: {
    stream: (r: GenerateRequest) => AsyncIterable<StreamEvent>;
  }) =>
    collectStream(provider.stream(request)).catch(
      (caught: unknown) => caught,
    );

  test.each([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_TIMEOUT",
  ])(
    "marks a send failure with cause code %s as retryable",
    async (code) => {
      const provider = providerFor(() => {
        throw withCode(code);
      });

      for (const error of [
        await generateError(provider),
        await streamError(provider),
      ]) {
        expect(error).toBeInstanceOf(ProviderRequestError);
        const failure = error as ProviderRequestError;
        expect(failure.message).toBe(
          "OpenRouter request failed to send: fetch failed: cause",
        );
        expect(failure.retryable).toBe(true);
        expect(failure.retryAfterMs).toBeUndefined();
      }
    },
  );

  test.each([
    withCode("DEPTH_ZERO_SELF_SIGNED_CERT"),
    withCode("ENOTFOUND"),
    withCode("ERR_INVALID_URL"),
    new TypeError("fetch failed"),
  ])("marks another send failure as not retryable", async (thrown) => {
    const provider = providerFor(() => {
      throw thrown;
    });

    const error = await generateError(provider);

    expect(error).toBeInstanceOf(ProviderRequestError);
    expect((error as ProviderRequestError).retryable).toBe(false);
  });

  test("marks a header value the request cannot carry as not retryable without sending", async () => {
    let called = false;
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      headers: { "X-Title": "a\nb" },
      fetch: async () => {
        called = true;
        return jsonResponse(okBody);
      },
    });

    const error = await generateError(provider);

    expect(error).toBeInstanceOf(ProviderRequestError);
    expect((error as ProviderRequestError).retryable).toBe(false);
    expect(called).toBe(false);
  });

  test.each([408, 429, 500, 503, 599])(
    "marks status %i as retryable and reads Retry-After",
    async (status) => {
      const cases: [string | undefined, number | undefined][] = [
        [undefined, undefined],
        ["7", 7000],
        ["Wed, 21 Oct 2015 07:28:00 GMT", 0],
        ["soon", undefined],
      ];
      for (const [header, expected] of cases) {
        const provider = providerFor(
          () =>
            new Response("busy", {
              status,
              ...(header !== undefined && {
                headers: { "Retry-After": header },
              }),
            }),
        );

        const error = await generateError(provider);

        expect(error).toBeInstanceOf(ProviderRequestError);
        const failure = error as ProviderRequestError;
        expect((failure.cause as OpenRouterHttpError).status).toBe(
          status,
        );
        expect(failure.retryable).toBe(true);
        expect(failure.retryAfterMs).toBe(expected);
      }
    },
  );

  test.each([400, 401, 402, 404])(
    "marks status %i as not retryable even with Retry-After",
    async (status) => {
      const provider = providerFor(
        () =>
          new Response("no", {
            status,
            headers: { "Retry-After": "7" },
          }),
      );

      const error = (await generateError(
        provider,
      )) as ProviderRequestError;

      expect(error).toBeInstanceOf(ProviderRequestError);
      expect(error.retryable).toBe(false);
      expect(error.retryAfterMs).toBeUndefined();
    },
  );

  test("marks a connection cut while reading the body as retryable", async () => {
    const provider = providerFor(() => failingBody(socketCut));

    const errors = [
      await generateError(provider),
      await streamError(provider),
      await provider
        .generate({ ...request, halt: new AbortController().signal })
        .catch((caught: unknown) => caught),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(ProviderRequestError);
      const failure = error as ProviderRequestError;
      expect(failure.message).toBe(
        "OpenRouter response body could not be read: terminated: other side closed",
      );
      expect(failure.retryable).toBe(true);
    }
  });

  test("marks another body read failure as not retryable", async () => {
    const provider = providerFor(() => failingBody(brokenGzip));

    for (const error of [
      await generateError(provider),
      await streamError(provider),
    ]) {
      expect(error).toBeInstanceOf(ProviderResponseError);
      const failure = error as ProviderResponseError;
      expect(failure.message).toBe(
        "OpenRouter response body could not be read: terminated: incorrect header check",
      );
      expect(failure.retryable).toBe(false);
    }
  });

  test("lets the status decide when a failure response body cannot be read", async () => {
    const retryable = providerFor(() =>
      failingBody(brokenGzip, 503, { headers: { "Retry-After": "4" } }),
    );
    const notRetryable = providerFor(() =>
      failingBody(socketCut, 400, { headers: { "Retry-After": "4" } }),
    );

    const first = (await generateError(
      retryable,
    )) as ProviderRequestError;
    const second = (await generateError(
      notRetryable,
    )) as ProviderRequestError;

    expect(first.message).toBe(
      "OpenRouter request failed: 503; the body could not be read: terminated: incorrect header check",
    );
    expect(first.retryable).toBe(true);
    expect(first.retryAfterMs).toBe(4000);
    expect(second.message).toBe(
      "OpenRouter request failed: 400; the body could not be read: terminated: other side closed",
    );
    expect(second.retryable).toBe(false);
    expect(second.retryAfterMs).toBeUndefined();
  });

  test.each([
    [
      "a stream without a body",
      "stream",
      null,
      "OpenRouter response has no body",
    ],
    [
      "a body that is not JSON",
      "generate",
      "not json",
      "OpenRouter response is not JSON",
    ],
    [
      "a body without choices",
      "generate",
      "{}",
      "OpenRouter response has no choices",
    ],
    [
      "a stream chunk that is not JSON",
      "stream",
      "data: nope\n\n",
      "OpenRouter stream chunk is not JSON",
    ],
    [
      "a stream chunk without choices",
      "stream",
      "data: {}\n\n",
      "OpenRouter stream chunk has no choices",
    ],
  ] as const)(
    "marks %s as not retryable",
    async (_name, call, body, message) => {
      const provider = providerFor(
        () => new Response(body, { status: 200 }),
      );

      const error = (
        call === "stream"
          ? await streamError(provider)
          : await generateError(provider)
      ) as ProviderResponseError;

      expect(error).toBeInstanceOf(ProviderResponseError);
      expect(error.messageWithoutServiceText.startsWith(message)).toBe(
        true,
      );
      expect(error.retryable).toBe(false);
    },
  );

  test("returns a halted answer when an abort follows a fired halt signal", async () => {
    const abort = new DOMException("aborted", "AbortError");
    const controller = new AbortController();
    const provider = providerFor(() => {
      controller.abort();
      throw abort;
    });

    const response = await provider.generate({
      ...request,
      halt: controller.signal,
    });

    expect(response).toEqual({ parts: [], finishReason: "halted" });
  });

  test("throws an abort from a failure response body unwrapped", async () => {
    const abort = new DOMException("aborted", "AbortError");
    const provider = providerFor(() => failingBody(abort, 503));

    const error = await generateError(provider);

    expect(error).toBe(abort);
  });
});
