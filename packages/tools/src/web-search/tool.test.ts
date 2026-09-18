import type { Tool } from "@mg/core";
import { describe, expect, expectTypeOf, test } from "vitest";
import { WebSearchError } from "./errors.js";
import { createWebSearchTool } from "./tool.js";
import type {
  WebSearchBackend,
  WebSearchContext,
  WebSearchRequest,
  WebSearchResult,
} from "./types.js";

const createFakeBackend = (
  results: WebSearchResult[],
): WebSearchBackend & {
  requests: WebSearchRequest[];
  contexts: WebSearchContext[];
} => {
  const requests: WebSearchRequest[] = [];
  const contexts: WebSearchContext[] = [];
  return {
    name: "FakeSearch",
    requests,
    contexts,
    async search(request, context) {
      requests.push(request);
      contexts.push(context);
      return results;
    },
  };
};

describe("createWebSearchTool", () => {
  test("is a Tool named web_search whose description names the backend", () => {
    const backend = createFakeBackend([]);
    const tool = createWebSearchTool({ backend });

    expectTypeOf(tool).toExtend<Tool>();
    expect(tool.name).toBe("web_search");
    expect(tool.description).toContain("FakeSearch");
  });

  test("passes the query and the default maxResults to the backend", async () => {
    const backend = createFakeBackend([]);
    const tool = createWebSearchTool({ backend });

    await tool.execute({ query: "cats" }, {});

    expect(backend.requests).toEqual([
      { query: "cats", maxResults: 5 },
    ]);
  });

  test("passes a custom maxResults to the backend", async () => {
    const backend = createFakeBackend([]);
    const tool = createWebSearchTool({ backend, maxResults: 2 });

    await tool.execute({ query: "cats" }, {});

    expect(backend.requests).toEqual([
      { query: "cats", maxResults: 2 },
    ]);
  });

  test("passes the abort signal to the backend", async () => {
    const backend = createFakeBackend([]);
    const tool = createWebSearchTool({ backend });
    const controller = new AbortController();

    await tool.execute(
      { query: "cats" },
      { signal: controller.signal },
    );

    expect(backend.contexts).toEqual([{ signal: controller.signal }]);
  });

  test("formats two results as a numbered list of title, url and snippet", async () => {
    const backend = createFakeBackend([
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
    const tool = createWebSearchTool({ backend });

    const result = await tool.execute({ query: "pets" }, {});

    expect(result).toBe(
      "1. Cats 101\n" +
        "   https://a.example/1\n" +
        "   About cats.\n" +
        "\n" +
        "2. Dogs 101\n" +
        "   https://a.example/2\n" +
        "   About dogs.",
    );
  });

  test("cuts a long snippet at maxSnippetChars and appends an ellipsis", async () => {
    const backend = createFakeBackend([
      { title: "T", url: "https://a.example", snippet: "0123456789" },
    ]);
    const tool = createWebSearchTool({ backend, maxSnippetChars: 5 });

    const result = await tool.execute({ query: "q" }, {});

    expect(result).toBe("1. T\n   https://a.example\n   01234…");
  });

  test("does not change a snippet at exactly the limit", async () => {
    const backend = createFakeBackend([
      { title: "T", url: "https://a.example", snippet: "01234" },
    ]);
    const tool = createWebSearchTool({ backend, maxSnippetChars: 5 });

    const result = await tool.execute({ query: "q" }, {});

    expect(result).toBe("1. T\n   https://a.example\n   01234");
  });

  test("collapses newlines and repeated spaces in a snippet to single spaces", async () => {
    const backend = createFakeBackend([
      {
        title: "T",
        url: "https://a.example",
        snippet: "line one\n  line   two\n\nline three",
      },
    ]);
    const tool = createWebSearchTool({ backend });

    const result = await tool.execute({ query: "q" }, {});

    expect(result).toBe(
      "1. T\n   https://a.example\n   line one line two line three",
    );
  });

  test("slices extra results when the backend returns more than maxResults", async () => {
    const backend = createFakeBackend([
      { title: "One", url: "https://a.example/1", snippet: "s1" },
      { title: "Two", url: "https://a.example/2", snippet: "s2" },
      { title: "Three", url: "https://a.example/3", snippet: "s3" },
    ]);
    const tool = createWebSearchTool({ backend, maxResults: 2 });

    const result = await tool.execute({ query: "q" }, {});

    expect(result).not.toContain("Three");
    expect(result.split("\n\n")).toHaveLength(2);
  });

  test("returns a no-results message for an empty array", async () => {
    const backend = createFakeBackend([]);
    const tool = createWebSearchTool({ backend });

    await expect(
      tool.execute({ query: "nothing here" }, {}),
    ).resolves.toBe('No results for "nothing here".');
  });

  test("rejects with the same WebSearchError instance thrown by the backend", async () => {
    const error = new WebSearchError("boom", {
      cause: new Error("network"),
    });
    const backend: WebSearchBackend = {
      name: "FakeSearch",
      async search() {
        throw error;
      },
    };
    const tool = createWebSearchTool({ backend });

    await expect(tool.execute({ query: "q" }, {})).rejects.toBe(error);
  });

  test("rejects with the same AbortError instance thrown by the backend", async () => {
    const controller = new AbortController();
    const error = new DOMException("aborted", "AbortError");
    const backend: WebSearchBackend = {
      name: "FakeSearch",
      async search() {
        throw error;
      },
    };
    const tool = createWebSearchTool({ backend });

    await expect(
      tool.execute({ query: "q" }, { signal: controller.signal }),
    ).rejects.toBe(error);
  });
});

describe("WebSearchError", () => {
  test("has name WebSearchError and keeps the cause", () => {
    const cause = new Error("network down");
    const error = new WebSearchError("search failed", { cause });

    expect(error.name).toBe("WebSearchError");
    expect(error.cause).toBe(cause);
  });
});
