import { describe, expect, test } from "vitest";
import { ProviderError, ToolArgumentsError } from "../errors.js";
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
    expect(call.init?.headers).toEqual({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
      "HTTP-Referer": "https://example.test",
      "X-Title": "mg",
    });
    expect(JSON.parse(String(call.init?.body))).toEqual({
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "weather?" }],
      stream: false,
      temperature: 0.2,
    });
  });

  test("uses the given base URL", async () => {
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      baseUrl: "https://proxy.test/v1",
      fetch: fetchStub,
    });

    await provider.generate(request);

    expect(calls[0]!.url).toBe("https://proxy.test/v1/chat/completions");
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

  test("throws a ProviderError carrying the status and the body", async () => {
    const { fetchStub } = stubFetch(
      () => new Response("rate limited", { status: 429 }),
    );
    const provider = createOpenRouterProvider({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await provider.generate(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    const providerError = error as ProviderError;
    expect(providerError.message).toBe("OpenRouter request failed: 429");
    expect(providerError.status).toBe(429);
    expect(providerError.body).toBe("rate limited");
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
  });
});
