import type { Tool } from "@mg/core";
import { z } from "zod";
import type { WebSearchBackend, WebSearchResult } from "./types.js";

export type WebSearchToolOptions = {
  backend: WebSearchBackend;
  maxResults?: number;
  maxSnippetChars?: number;
};

const webSearchInput = z.object({
  query: z.string().min(1).describe("Search query"),
});

const normalizeText = (text: string): string =>
  text.trim().replace(/\s+/g, " ");

const truncateSnippet = (snippet: string, maxChars: number): string => {
  const normalized = normalizeText(snippet);
  const chars = Array.from(normalized);
  return chars.length > maxChars
    ? `${chars.slice(0, maxChars).join("")}…`
    : normalized;
};

const formatResult = (
  result: WebSearchResult,
  maxSnippetChars: number,
): string =>
  `${normalizeText(result.title)}\n   ${normalizeText(result.url)}\n   ${truncateSnippet(result.snippet, maxSnippetChars)}`;

const formatResults = (
  results: WebSearchResult[],
  maxSnippetChars: number,
): string =>
  results
    .map(
      (result, index) =>
        `${index + 1}. ${formatResult(result, maxSnippetChars)}`,
    )
    .join("\n\n");

export const createWebSearchTool = (
  options: WebSearchToolOptions,
): Tool<typeof webSearchInput> => {
  const { backend, maxResults = 5, maxSnippetChars = 500 } = options;

  return {
    name: "web_search",
    description:
      `Searches the web with ${backend.name} and returns titles, URLs ` +
      "and short snippets, not full pages. Returns at most " +
      `${maxResults} results.`,
    input: webSearchInput,
    async execute({ query }, context) {
      const results = await backend.search(
        { query, maxResults },
        { signal: context.signal },
      );
      const sliced = results.slice(0, maxResults);

      if (sliced.length === 0) return `No results for "${query}".`;

      return formatResults(sliced, maxSnippetChars);
    },
  };
};
