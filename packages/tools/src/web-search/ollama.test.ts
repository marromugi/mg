import { describe, expect, test } from "vitest";
import { createOllamaWebSearchBackend } from "./ollama.js";
import { WebSearchError } from "./errors.js";

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

const okBody = {
  results: [
    {
      title: "Cats 101",
      url: "https://a.example/1",
      content: "About cats.",
    },
    {
      title: "Dogs 101",
      url: "https://a.example/2",
      content: "About dogs.",
    },
  ],
};

describe("createOllamaWebSearchBackend", () => {
  test("exposes its own name", () => {
    const backend = createOllamaWebSearchBackend({
      apiKey: "test-key",
    });

    expect(backend.name).toBe("ollama");
  });

  test("sends the expected URL, method, headers and body", async () => {
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const backend = createOllamaWebSearchBackend({
      apiKey: "test-key",
      headers: { "X-Extra": "yes" },
      fetch: fetchStub,
    });

    await backend.search({ query: "cats", maxResults: 5 }, {});

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe("https://ollama.com/api/web_search");
    expect(call.init?.method).toBe("POST");
    expect([...new Headers(call.init?.headers)].sort()).toEqual([
      ["authorization", "Bearer test-key"],
      ["content-type", "application/json"],
      ["x-extra", "yes"],
    ]);
  });

  test.each([
    ["https://proxy.test", "https://proxy.test/api/web_search"],
    ["https://proxy.test/", "https://proxy.test/api/web_search"],
  ])("uses the given base URL %s", async (baseUrl, expected) => {
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const backend = createOllamaWebSearchBackend({
      apiKey: "test-key",
      baseUrl,
      fetch: fetchStub,
    });

    await backend.search({ query: "cats", maxResults: 5 }, {});

    expect(calls[0].url).toBe(expected);
  });

  test("sends the query and maxResults as the request body", async () => {
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const backend = createOllamaWebSearchBackend({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    await backend.search({ query: "cats", maxResults: 7 }, {});

    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      query: "cats",
      max_results: 7,
    });
  });

  test("passes the abort signal to fetch", async () => {
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const backend = createOllamaWebSearchBackend({
      apiKey: "test-key",
      fetch: fetchStub,
    });
    const controller = new AbortController();

    await backend.search(
      { query: "cats", maxResults: 5 },
      { signal: controller.signal },
    );

    expect(calls[0].init?.signal).toBe(controller.signal);
  });

  test("maps results to title, url and snippet, keeping order", async () => {
    const { fetchStub } = stubFetch(() => jsonResponse(okBody));
    const backend = createOllamaWebSearchBackend({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    await expect(
      backend.search({ query: "pets", maxResults: 5 }, {}),
    ).resolves.toEqual([
      {
        title: "Cats 101",
        url: "https://a.example/1",
        snippet: "About cats.",
      },
      {
        title: "Dogs 101",
        url: "https://a.example/2",
        snippet: "About dogs.",
      },
    ]);
  });

  test("ignores unknown keys in the response", async () => {
    const { fetchStub } = stubFetch(() =>
      jsonResponse({
        results: [
          {
            title: "Cats 101",
            url: "https://a.example/1",
            content: "About cats.",
            extra: "ignored",
          },
        ],
        extra: "ignored",
      }),
    );
    const backend = createOllamaWebSearchBackend({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    await expect(
      backend.search({ query: "cats", maxResults: 5 }, {}),
    ).resolves.toEqual([
      {
        title: "Cats 101",
        url: "https://a.example/1",
        snippet: "About cats.",
      },
    ]);
  });

  test("rejects with a WebSearchError whose message names the status and a body snippet", async () => {
    const { fetchStub } = stubFetch(
      () =>
        new Response("rate limited, try again later", { status: 429 }),
    );
    const backend = createOllamaWebSearchBackend({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await backend
      .search({ query: "cats", maxResults: 5 }, {})
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WebSearchError);
    expect((error as WebSearchError).message).toContain("429");
    expect((error as WebSearchError).message).toContain(
      "rate limited, try again later",
    );
  });

  test("cuts a non-2xx body snippet at 200 characters", async () => {
    const longBody = "x".repeat(300);
    const { fetchStub } = stubFetch(
      () => new Response(longBody, { status: 500 }),
    );
    const backend = createOllamaWebSearchBackend({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = (await backend
      .search({ query: "cats", maxResults: 5 }, {})
      .catch((caught: unknown) => caught)) as WebSearchError;

    expect(error.message).not.toContain("x".repeat(201));
    expect(error.message).toContain("x".repeat(200));
  });

  test("rejects with a WebSearchError when a non-JSON body is not JSON", async () => {
    const { fetchStub } = stubFetch(
      () =>
        new Response("<html>maintenance</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    );
    const backend = createOllamaWebSearchBackend({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await backend
      .search({ query: "cats", maxResults: 5 }, {})
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WebSearchError);
    expect((error as WebSearchError).cause).toBeInstanceOf(SyntaxError);
  });

  test("rejects with a WebSearchError when the body has the wrong shape", async () => {
    const { fetchStub } = stubFetch(() =>
      jsonResponse({ results: [{ title: "Only a title" }] }),
    );
    const backend = createOllamaWebSearchBackend({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await backend
      .search({ query: "cats", maxResults: 5 }, {})
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WebSearchError);
  });

  test("rejects with a WebSearchError carrying the original error when fetch rejects", async () => {
    const failure = new TypeError("fetch failed");
    const { fetchStub } = stubFetch(() => {
      throw failure;
    });
    const backend = createOllamaWebSearchBackend({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await backend
      .search({ query: "cats", maxResults: 5 }, {})
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WebSearchError);
    expect((error as WebSearchError).cause).toBe(failure);
  });

  test("rejects without calling fetch when the signal is already aborted", async () => {
    const { fetchStub, calls } = stubFetch(() => jsonResponse(okBody));
    const backend = createOllamaWebSearchBackend({
      apiKey: "test-key",
      fetch: fetchStub,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      backend.search(
        { query: "cats", maxResults: 5 },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  test("rethrows an abort from reading the response body without wrapping it", async () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    const { fetchStub } = stubFetch(
      () =>
        new Response(
          new ReadableStream({
            start: (controller) => {
              controller.error(abort);
            },
          }),
          { status: 200 },
        ),
    );
    const backend = createOllamaWebSearchBackend({
      apiKey: "test-key",
      fetch: fetchStub,
    });

    const error = await backend
      .search({ query: "cats", maxResults: 5 }, {})
      .catch((caught: unknown) => caught);

    expect(error).toBe(abort);
  });
});
