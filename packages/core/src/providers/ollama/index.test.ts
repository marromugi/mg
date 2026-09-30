import { describe, expect, test } from "vitest";
import {
  ProviderHttpError,
  ProviderTransportError,
  ProviderUnsupportedError,
  ToolArgumentsError,
} from "../errors.js";
import type {
  GenerateRequest,
  StreamEvent,
  ToolChoice,
} from "../types.js";
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
      parts: [{ type: "text", text: "24 degrees" }],
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
    const provider = createOllamaProvider({
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
  });
});

const sequentialIds = (): (() => string) => {
  let count = 0;
  return () => {
    count += 1;
    return `u${count}`;
  };
};

const oneToolCallBody = {
  message: {
    role: "assistant",
    content: "",
    tool_calls: [
      { function: { name: "weather", arguments: { city: "Tokyo" } } },
    ],
  },
  done: true,
  done_reason: "stop",
};

describe("createOllamaProvider tool call ids", () => {
  test("continues the generator across two generate calls", async () => {
    const { fetchStub } = stubFetch(() =>
      jsonResponse(oneToolCallBody),
    );
    const provider = createOllamaProvider({
      fetch: fetchStub,
      newToolCallId: sequentialIds(),
    });

    const first = await provider.generate(request);
    const second = await provider.generate(request);

    expect(
      [first, second].map((response) =>
        response.parts.map((part) =>
          part.type === "tool-call" ? part.id : undefined,
        ),
      ),
    ).toEqual([["u1"], ["u2"]]);
  });

  test("gives distinct UUIDs without a generator", async () => {
    const { fetchStub } = stubFetch(() =>
      jsonResponse({
        ...oneToolCallBody,
        message: {
          ...oneToolCallBody.message,
          tool_calls: [
            {
              id: "call_ab12cd34",
              function: { name: "a", arguments: {} },
            },
            { function: { name: "b", arguments: {} } },
          ],
        },
      }),
    );
    const provider = createOllamaProvider({ fetch: fetchStub });

    const response = await provider.generate(request);
    const ids = response.parts.map((part) =>
      part.type === "tool-call" ? part.id : "",
    );

    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(ids[0]).toMatch(uuid);
    expect(ids[1]).toMatch(uuid);
    expect(ids[0]).not.toBe(ids[1]);
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

describe("createOllamaProvider halt", () => {
  const haltRequest: GenerateRequest = {
    model: "m",
    messages: [{ role: "user", content: "hi" }],
  };

  const stallingNdjsonBody = (chunks: unknown[]) => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(
            encoder.encode(`${JSON.stringify(chunk)}\n`),
          );
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
    const { response, wasCancelled } = stallingNdjsonBody([
      { message: { content: "Hel" }, done: false },
    ]);
    const { fetchStub } = stubFetch(() => response);
    const provider = createOllamaProvider({ fetch: fetchStub });
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

  test("keeps a tool call already yielded before the signal fires", async () => {
    const { response } = stallingNdjsonBody([
      { message: { content: "a" }, done: false },
      {
        message: {
          content: "",
          tool_calls: [{ function: { name: "ls", arguments: {} } }],
        },
        done: false,
      },
    ]);
    const { fetchStub } = stubFetch(() => response);
    const provider = createOllamaProvider({
      fetch: fetchStub,
      newToolCallId: () => "u1",
    });
    const controller = new AbortController();

    const stream = provider.stream({
      ...haltRequest,
      halt: controller.signal,
    });
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    const second = await iterator.next();
    controller.abort();
    const rest = await collectStream({
      [Symbol.asyncIterator]: () => iterator,
    });

    expect([first.value, second.value, ...rest]).toEqual([
      { type: "text-delta", delta: "a" },
      {
        type: "tool-call",
        toolCall: { id: "u1", name: "ls", arguments: {} },
      },
      { type: "finish", finishReason: "halted" },
    ]);
  });

  test("returns an empty answer with a halted reason when the signal fires before the body closes", async () => {
    const { response, wasCancelled } = neverClosingResponse();
    const { fetchStub } = stubFetch(() => response);
    const provider = createOllamaProvider({ fetch: fetchStub });
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
        message: { role: "assistant", content: "ok" },
        done: true,
        done_reason: "stop",
      }),
    );
    const provider = createOllamaProvider({ fetch: fetchStub });
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
        message: { role: "assistant", content: "ok" },
        done: true,
        done_reason: "stop",
      }),
    );
    const provider = createOllamaProvider({ fetch: fetchStub });

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
    const provider = createOllamaProvider({ fetch: fetchStub });
    const controller = new AbortController();

    const error = await provider
      .generate({ ...haltRequest, halt: controller.signal })
      .catch((caught: unknown) => caught);

    expect(error).toBe(abort);
  });

  test("carries no halt key in the request body", async () => {
    const { fetchStub, calls } = stubFetch(() =>
      closingResponse({
        message: { role: "assistant", content: "ok" },
        done: true,
        done_reason: "stop",
      }),
    );
    const provider = createOllamaProvider({ fetch: fetchStub });
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

describe("createOllamaProvider with an authored user message", () => {
  const authoredOkBody = {
    message: { role: "assistant", content: "ok" },
    done: true,
    done_reason: "stop",
  };

  test("sends the same batch request body whether or not the user message carries an author", async () => {
    const { fetchStub: authoredFetch, calls: authoredCalls } =
      stubFetch(() => jsonResponse(authoredOkBody));
    const authoredProvider = createOllamaProvider({
      fetch: authoredFetch,
    });
    await authoredProvider.generate({
      model: "m",
      messages: [{ role: "user", author: "alice", content: "hi" }],
    });

    const { fetchStub: plainFetch, calls: plainCalls } = stubFetch(() =>
      jsonResponse(authoredOkBody),
    );
    const plainProvider = createOllamaProvider({ fetch: plainFetch });
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
    const { fetchStub: authoredFetch, calls: authoredCalls } =
      stubFetch(() => ndjsonResponse([authoredOkBody]));
    const authoredProvider = createOllamaProvider({
      fetch: authoredFetch,
    });
    await collectStream(
      authoredProvider.stream({
        model: "m",
        messages: [{ role: "user", author: "alice", content: "hi" }],
      }),
    );

    const { fetchStub: plainFetch, calls: plainCalls } = stubFetch(() =>
      ndjsonResponse([authoredOkBody]),
    );
    const plainProvider = createOllamaProvider({ fetch: plainFetch });
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
});

describe("createOllamaProvider tool forcing", () => {
  const tool = {
    name: "t",
    input: {
      "~standard": {
        version: 1,
        vendor: "mg-test",
        jsonSchema: {
          input: () => ({ type: "object" }),
          output: () => ({ type: "object" }),
        },
      },
    },
  } as never;

  test("declares that it cannot force a tool call", () => {
    const { fetchStub } = stubFetch(() => jsonResponse(okBody));

    expect(createOllamaProvider({ fetch: fetchStub }).toolForcing).toBe(
      false,
    );
  });

  test.each<ToolChoice>(["required", { type: "tool", name: "t" }])(
    "rejects the tool choice %j without sending anything",
    async (toolChoice) => {
      const { fetchStub, calls } = stubFetch(() =>
        jsonResponse(okBody),
      );
      const provider = createOllamaProvider({ fetch: fetchStub });

      const error = await provider
        .generate({ ...request, tools: [tool], toolChoice })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ProviderUnsupportedError);
      expect((error as ProviderUnsupportedError).feature).toBe(
        "tool-choice",
      );
      expect((error as ProviderUnsupportedError).message).toBe(
        "Ollama does not support forcing tool use",
      );
      expect(calls).toHaveLength(0);
    },
  );
});

describe("createOllamaProvider retry marks", () => {
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
    createOllamaProvider({
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
        expect(error).toBeInstanceOf(ProviderTransportError);
        const failure = error as ProviderTransportError;
        expect(failure.message).toBe("Ollama request failed to send");
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

    expect(error).toBeInstanceOf(ProviderTransportError);
    expect((error as ProviderTransportError).message).toBe(
      "Ollama request failed to send",
    );
    expect((error as ProviderTransportError).retryable).toBe(false);
  });

  test("marks a header value the request cannot carry as not retryable without sending", async () => {
    let called = false;
    const provider = createOllamaProvider({
      headers: { "X-Title": "a\nb" },
      fetch: async () => {
        called = true;
        return jsonResponse(okBody);
      },
    });

    const error = await generateError(provider);

    expect(error).toBeInstanceOf(ProviderTransportError);
    expect((error as ProviderTransportError).message).toBe(
      "Ollama request failed to send",
    );
    expect((error as ProviderTransportError).retryable).toBe(false);
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

        expect(error).toBeInstanceOf(ProviderHttpError);
        const failure = error as ProviderHttpError;
        expect(failure.status).toBe(status);
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
      )) as ProviderHttpError;

      expect(error).toBeInstanceOf(ProviderHttpError);
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
      expect(error).toBeInstanceOf(ProviderTransportError);
      const failure = error as ProviderTransportError;
      expect(failure.message).toBe("Ollama response failed to read");
      expect(failure.retryable).toBe(true);
    }
  });

  test("marks another body read failure as not retryable", async () => {
    const provider = providerFor(() => failingBody(brokenGzip));

    for (const error of [
      await generateError(provider),
      await streamError(provider),
    ]) {
      expect(error).toBeInstanceOf(ProviderTransportError);
      const failure = error as ProviderTransportError;
      expect(failure.message).toBe("Ollama response failed to read");
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
    )) as ProviderTransportError;
    const second = (await generateError(
      notRetryable,
    )) as ProviderTransportError;

    expect(first.message).toBe("Ollama response failed to read");
    expect(first.retryable).toBe(true);
    expect(first.retryAfterMs).toBe(4000);
    expect(second.message).toBe("Ollama response failed to read");
    expect(second.retryable).toBe(false);
    expect(second.retryAfterMs).toBeUndefined();
  });

  test.each([
    [
      "a stream without a body",
      "stream",
      null,
      "Ollama response has no body",
    ],
    [
      "a body that is not JSON",
      "generate",
      "not json",
      "Ollama response is not JSON",
    ],
    [
      "a body without a message",
      "generate",
      "{}",
      "Ollama response has no message",
    ],
    [
      "a stream chunk that is not JSON",
      "stream",
      "nope\n",
      "Ollama stream chunk is not JSON",
    ],
    [
      "a stream line with an error field",
      "stream",
      '{"error":"model crashed"}\n',
      "Ollama stream failed",
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
      ) as ProviderHttpError;

      expect(error).toBeInstanceOf(ProviderHttpError);
      expect(error.message).toBe(message);
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
