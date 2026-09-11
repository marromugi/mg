import { describe, expect, test } from "vitest";
import {
  ProviderHttpError,
  ProviderTransportError,
  ToolArgumentsError,
} from "../errors.js";
import type { GenerateRequest } from "../types.js";
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
  choices: [{ message: { content: "24 degrees" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 12, completion_tokens: 34 },
};

describe("createOpenRouterProvider", () => {
  test("sends the expected URL, method, headers and body", async () => {
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      headers: { "HTTP-Referer": "https://example.test", "X-Title": "mg" },
      fetch: fetchStub,
    });

    await provider.generate(request);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://openrouter.ai/api/v1/chat/completions");
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
      headers: { authorization: "Bearer other", "content-type": "text/plain" },
      fetch: fetchStub,
    });

    await provider.generate(request);

    const headers = [...new Headers(calls[0]!.init?.headers)];
    expect(headers.filter(([name]) => name === "authorization")).toEqual([
      ["authorization", "Bearer test-key"],
    ]);
    expect(headers.filter(([name]) => name === "content-type")).toEqual([
      ["content-type", "application/json"],
    ]);
  });

  test.each([
    ["https://proxy.test/v1", "https://proxy.test/v1/chat/completions"],
    ["https://example.test/v1/", "https://example.test/v1/chat/completions"],
  ])("uses the given base URL %s", async (baseUrl, expected) => {
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      baseUrl,
      fetch: fetchStub,
    });

    await provider.generate(request);

    expect(calls[0]!.url).toBe(expected);
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
      content: "24 degrees",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 12, outputTokens: 34 },
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

    const error = await provider.generate(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderHttpError);
    const providerError = error as ProviderHttpError;
    expect(providerError.message).toBe("OpenRouter request failed: 429");
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

    const error = await provider.generate(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderHttpError);
    const providerError = error as ProviderHttpError;
    expect(providerError.message).toBe("OpenRouter response is not JSON");
    expect(providerError.status).toBe(200);
    expect(providerError.body).toBe("<html>maintenance</html>");
  });

  test("throws a ProviderHttpError when the answer carries no choices", async () => {
    const body = { error: { code: 502, message: "Provider returned error" } };
    const { fetchStub } = stubFetch(() => jsonResponse(body));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await provider.generate(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderHttpError);
    const providerError = error as ProviderHttpError;
    expect(providerError.message).toBe("OpenRouter response has no choices");
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

    const error = await provider.generate(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderTransportError);
    const transportError = error as ProviderTransportError;
    expect(transportError.message).toBe("OpenRouter request failed to send");
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

    const error = await provider.generate(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderTransportError);
    const transportError = error as ProviderTransportError;
    expect(transportError.message).toBe("OpenRouter response failed to read");
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

    const error = await provider.generate(request).catch((caught: unknown) => caught);

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
                  function: { name: "weather", arguments: "{ not json" },
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

    const error = await provider.generate(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ToolArgumentsError);
    const toolArgumentsError = error as ToolArgumentsError;
    expect(toolArgumentsError.toolCallId).toBe("call-1");
    expect(toolArgumentsError.toolName).toBe("weather");
    expect(toolArgumentsError.raw).toBe("{ not json");
    expect(toolArgumentsError.cause).toBeInstanceOf(SyntaxError);
  });
});
