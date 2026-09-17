import { describe, expect, test } from "vitest";
import {
  ProviderHttpError,
  ProviderTransportError,
  ToolArgumentsError,
} from "../errors.js";
import type { GenerateRequest, StreamEvent } from "../types.js";
import { createOllamaProvider } from "./index.js";

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
  model: "llama3",
  messages: [{ role: "user", content: "weather?" }],
  temperature: 0.2,
};

const okBody = {
  message: { content: "24 degrees" },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 12,
  eval_count: 34,
};

describe("createOllamaProvider", () => {
  test("exposes its own name", () => {
    const provider = createOllamaProvider();

    expect(provider.name).toBe("ollama");
  });

  test("sends the expected URL, method, headers and body against the default base URL", async () => {
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const provider = createOllamaProvider({ fetch: fetchStub });

    await provider.generate(request);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe("http://localhost:11434/api/chat");
    expect(call.init?.method).toBe("POST");
    expect([...new Headers(call.init?.headers)]).toEqual([
      ["content-type", "application/json"],
    ]);
    expect(JSON.parse(String(call.init?.body))).toEqual({
      model: "llama3",
      messages: [{ role: "user", content: "weather?" }],
      stream: false,
      options: { temperature: 0.2 },
    });
  });

  test("passes caller headers through without adding an Authorization header", async () => {
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const provider = createOllamaProvider({
      headers: { "X-Trace": "abc" },
      fetch: fetchStub,
    });

    await provider.generate(request);

    expect([...new Headers(calls[0].init?.headers)].sort()).toEqual([
      ["content-type", "application/json"],
      ["x-trace", "abc"],
    ]);
  });

  test.each([
    ["http://example.test:11434", "http://example.test:11434/api/chat"],
    [
      "http://example.test:11434/",
      "http://example.test:11434/api/chat",
    ],
  ])("uses the given base URL %s", async (baseUrl, expected) => {
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const provider = createOllamaProvider({
      baseUrl,
      fetch: fetchStub,
    });

    await provider.generate(request);

    expect(calls[0].url).toBe(expected);
  });

  test("carries think, keep_alive and options.num_ctx in the request body", async () => {
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const provider = createOllamaProvider({
      think: false,
      keepAlive: "5m",
      numCtx: 4096,
      fetch: fetchStub,
    });

    await provider.generate(request);

    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      model: "llama3",
      messages: [{ role: "user", content: "weather?" }],
      stream: false,
      think: false,
      keep_alive: "5m",
      options: { temperature: 0.2, num_ctx: 4096 },
    });
  });

  test("resolves the global fetch at call time", async () => {
    const provider = createOllamaProvider();
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
    const provider = createOllamaProvider({ fetch: fetchStub });

    await expect(provider.generate(request)).resolves.toEqual({
      content: "24 degrees",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 12, outputTokens: 34 },
    });
  });

  test("throws a ProviderHttpError carrying the status and the body", async () => {
    const { fetchStub } = stubFetch(
      () =>
        new Response(JSON.stringify({ error: "model 'x' not found" }), {
          status: 404,
        }),
    );
    const provider = createOllamaProvider({ fetch: fetchStub });

    const error = await provider
      .generate(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderHttpError);
    const providerError = error as ProviderHttpError;
    expect(providerError.message).toBe("Ollama request failed: 404");
    expect(providerError.status).toBe(404);
    expect(providerError.body).toBe(
      JSON.stringify({ error: "model 'x' not found" }),
    );
  });

  test("throws a ProviderHttpError when a 2xx body is not JSON", async () => {
    const { fetchStub } = stubFetch(
      () =>
        new Response("<html>maintenance</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    );
    const provider = createOllamaProvider({ fetch: fetchStub });

    const error = await provider
      .generate(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderHttpError);
    const providerError = error as ProviderHttpError;
    expect(providerError.message).toBe("Ollama response is not JSON");
    expect(providerError.status).toBe(200);
    expect(providerError.body).toBe("<html>maintenance</html>");
  });

  test("throws a ProviderTransportError when the request cannot be sent", async () => {
    const failure = new TypeError("fetch failed", {
      cause: new Error("ENOTFOUND"),
    });
    const { fetchStub } = stubFetch(() => {
      throw failure;
    });
    const provider = createOllamaProvider({ fetch: fetchStub });

    const error = await provider
      .generate(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderTransportError);
    const transportError = error as ProviderTransportError;
    expect(transportError.message).toBe(
      "Ollama request failed to send",
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
    const provider = createOllamaProvider({ fetch: fetchStub });

    const error = await provider
      .generate(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderTransportError);
    const transportError = error as ProviderTransportError;
    expect(transportError.message).toBe(
      "Ollama response failed to read",
    );
    expect(transportError.cause).toBe(failure);
  });

  test("passes an abort through without wrapping it", async () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    const { fetchStub } = stubFetch(() => {
      throw abort;
    });
    const provider = createOllamaProvider({ fetch: fetchStub });

    const error = await provider
      .generate(request)
      .catch((caught: unknown) => caught);

    expect(error).toBe(abort);
  });

  test("throws a ToolArgumentsError when tool call arguments are not an object", async () => {
    const { fetchStub } = stubFetch(() =>
      jsonResponse({
        message: {
          content: "",
          tool_calls: [
            {
              id: "call-1",
              function: { name: "weather", arguments: "not-an-object" },
            },
          ],
        },
        done: true,
        done_reason: "tool_calls",
      }),
    );
    const provider = createOllamaProvider({ fetch: fetchStub });

    const error = await provider
      .generate(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ToolArgumentsError);
    const toolArgumentsError = error as ToolArgumentsError;
    expect(toolArgumentsError.toolCallId).toBe("call-1");
    expect(toolArgumentsError.toolName).toBe("weather");
  });
});

const ndjsonResponse = (chunks: unknown[]) =>
  new Response(
    chunks.map((chunk) => `${JSON.stringify(chunk)}\n`).join(""),
    { status: 200 },
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

describe("createOllamaProvider stream", () => {
  test("asks for a streamed answer with usage and yields the events", async () => {
    const { fetchStub, calls } = stubFetch(() =>
      ndjsonResponse([
        { message: { content: "24" }, done: false },
        { message: { content: " degrees" }, done: false },
        {
          message: { content: "" },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 12,
          eval_count: 34,
        },
      ]),
    );
    const provider = createOllamaProvider({ fetch: fetchStub });

    const events = await collectStream(provider.stream(request));

    expect(calls[0].url).toBe("http://localhost:11434/api/chat");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      stream: true,
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
    const { fetchStub, calls } = stubFetch(() =>
      ndjsonResponse([
        { message: { content: "" }, done: true, done_reason: "stop" },
      ]),
    );
    const provider = createOllamaProvider({ fetch: fetchStub });

    const stream = provider.stream(request);
    expect(calls).toHaveLength(0);

    await collectStream(stream);
    expect(calls).toHaveLength(1);
  });

  test("throws a ProviderHttpError before any event on a non-2xx", async () => {
    const { fetchStub } = stubFetch(
      () =>
        new Response(JSON.stringify({ error: "model 'x' not found" }), {
          status: 404,
        }),
    );
    const provider = createOllamaProvider({ fetch: fetchStub });

    const events: StreamEvent[] = [];
    const error = await collectStream(
      provider.stream(request),
      events,
    ).catch((caught: unknown) => caught);

    expect(events).toEqual([]);
    expect(error).toBeInstanceOf(ProviderHttpError);
    const httpError = error as ProviderHttpError;
    expect(httpError.message).toBe("Ollama request failed: 404");
    expect(httpError.status).toBe(404);
  });

  test("throws a ProviderHttpError when the answer carries no body", async () => {
    const { fetchStub } = stubFetch(
      () => new Response(null, { status: 204 }),
    );
    const provider = createOllamaProvider({ fetch: fetchStub });

    const error = await collectStream(provider.stream(request)).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderHttpError);
    const httpError = error as ProviderHttpError;
    expect(httpError.message).toBe("Ollama response has no body");
    expect(httpError.status).toBe(204);
    expect(httpError.body).toBe("");
  });

  test("throws a ProviderTransportError when the request cannot be sent", async () => {
    const failure = new TypeError("fetch failed");
    const { fetchStub } = stubFetch(() => {
      throw failure;
    });
    const provider = createOllamaProvider({ fetch: fetchStub });

    const error = await collectStream(provider.stream(request)).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderTransportError);
    const transportError = error as ProviderTransportError;
    expect(transportError.message).toBe(
      "Ollama request failed to send",
    );
    expect(transportError.cause).toBe(failure);
  });

  test("throws a ProviderTransportError when the body fails midway", async () => {
    const failure = new Error("connection reset");
    const prelude = `${JSON.stringify({
      message: { content: "24" },
      done: false,
    })}\n`;
    const { fetchStub } = stubFetch(() =>
      erroringResponse(failure, prelude),
    );
    const provider = createOllamaProvider({ fetch: fetchStub });

    const events: StreamEvent[] = [];
    const error = await collectStream(
      provider.stream(request),
      events,
    ).catch((caught: unknown) => caught);

    expect(events).toEqual([{ type: "text-delta", delta: "24" }]);
    expect(error).toBeInstanceOf(ProviderTransportError);
    const transportError = error as ProviderTransportError;
    expect(transportError.message).toBe(
      "Ollama response failed to read",
    );
    expect(transportError.cause).toBe(failure);
  });

  test("passes an abort from the body through without wrapping it", async () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    const { fetchStub } = stubFetch(() => erroringResponse(abort));
    const provider = createOllamaProvider({ fetch: fetchStub });

    const error = await collectStream(provider.stream(request)).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBe(abort);
  });

  test("throws a ProviderHttpError when a streamed chunk is not JSON", async () => {
    const { fetchStub } = stubFetch(
      () => new Response("<html>\n", { status: 200 }),
    );
    const provider = createOllamaProvider({ fetch: fetchStub });

    const error = await collectStream(provider.stream(request)).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderHttpError);
    const httpError = error as ProviderHttpError;
    expect(httpError.message).toBe("Ollama stream chunk is not JSON");
    expect(httpError.status).toBe(200);
    expect(httpError.body).toBe("<html>");
  });
});
