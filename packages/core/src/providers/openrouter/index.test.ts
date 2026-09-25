import { describe, expect, test } from "vitest";
import {
  ProviderHttpError,
  ProviderTransportError,
  ToolArgumentsError,
} from "../errors.js";
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

  test("throws a ProviderHttpError carrying the status and the body", async () => {
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

    expect(error).toBeInstanceOf(ProviderHttpError);
    const providerError = error as ProviderHttpError;
    expect(providerError.message).toBe(
      "OpenRouter request failed: 429",
    );
    expect(providerError.status).toBe(429);
    expect(providerError.body).toBe("rate limited");
  });

  test("throws a ProviderHttpError when a 2xx body is not JSON", async () => {
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

    expect(error).toBeInstanceOf(ProviderHttpError);
    const providerError = error as ProviderHttpError;
    expect(providerError.message).toBe(
      "OpenRouter response is not JSON",
    );
    expect(providerError.status).toBe(200);
    expect(providerError.body).toBe("<html>maintenance</html>");
  });

  test("throws a ProviderHttpError when the answer carries no choices", async () => {
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

    expect(error).toBeInstanceOf(ProviderHttpError);
    const providerError = error as ProviderHttpError;
    expect(providerError.message).toBe(
      "OpenRouter response has no choices",
    );
    expect(providerError.body).toBe(JSON.stringify(body));
  });

  test("throws a ProviderTransportError when the request cannot be sent", async () => {
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

    expect(error).toBeInstanceOf(ProviderTransportError);
    const transportError = error as ProviderTransportError;
    expect(transportError.message).toBe(
      "OpenRouter request failed to send",
    );
    expect(transportError.cause).toBe(failure);
  });

  test("throws a ProviderTransportError when the answer cannot be read", async () => {
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

    expect(error).toBeInstanceOf(ProviderTransportError);
    const transportError = error as ProviderTransportError;
    expect(transportError.message).toBe(
      "OpenRouter response failed to read",
    );
    expect(transportError.cause).toBe(failure);
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
    });

    const error = await provider
      .generate(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ToolArgumentsError);
    const toolArgumentsError = error as ToolArgumentsError;
    expect(toolArgumentsError.toolCallId).toBe("call-1");
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
          id: "call-1",
          name: "weather",
          arguments: {},
        },
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
    });

    await expect(
      collectStream(provider.stream(request)),
    ).resolves.toEqual([
      {
        type: "tool-call",
        toolCall: {
          id: "call-1",
          name: "weather",
          arguments: { city: "Tokyo" },
        },
      },
      { type: "finish", finishReason: "tool_calls" },
    ]);
  });

  test("throws a ProviderHttpError before any event on a non-2xx", async () => {
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
    expect(error).toBeInstanceOf(ProviderHttpError);
    const httpError = error as ProviderHttpError;
    expect(httpError.message).toBe("OpenRouter request failed: 429");
    expect(httpError.status).toBe(429);
    expect(httpError.body).toBe("rate limited");
  });

  test("throws a ProviderHttpError when the answer carries no body", async () => {
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

    expect(error).toBeInstanceOf(ProviderHttpError);
    const httpError = error as ProviderHttpError;
    expect(httpError.message).toBe("OpenRouter response has no body");
    expect(httpError.status).toBe(204);
    expect(httpError.body).toBe("");
  });

  test("throws a ProviderTransportError when the request cannot be sent", async () => {
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

    expect(error).toBeInstanceOf(ProviderTransportError);
    const transportError = error as ProviderTransportError;
    expect(transportError.message).toBe(
      "OpenRouter request failed to send",
    );
    expect(transportError.cause).toBe(failure);
  });

  test("throws a ProviderTransportError when the body fails midway", async () => {
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
    expect(error).toBeInstanceOf(ProviderTransportError);
    const transportError = error as ProviderTransportError;
    expect(transportError.message).toBe(
      "OpenRouter response failed to read",
    );
    expect(transportError.cause).toBe(failure);
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

  test("throws a ProviderHttpError when a streamed payload is not JSON", async () => {
    const { fetchStub } = stubFetch(() => sseResponse(["<html>"]));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await collectStream(provider.stream(request)).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderHttpError);
    const httpError = error as ProviderHttpError;
    expect(httpError.message).toBe(
      "OpenRouter stream chunk is not JSON",
    );
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
