import { z } from "zod";
import { isAbortError } from "./abort.js";
import { WebSearchError } from "./errors.js";
import type { WebSearchBackend, WebSearchResult } from "./types.js";

const DEFAULT_BASE_URL = "https://ollama.com";
const ERROR_BODY_SNIPPET_CHARS = 200;

export type OllamaWebSearchOptions = {
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

const responseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string(),
    }),
  ),
});

const resolveAbort = (
  cause: unknown,
  signal: AbortSignal | undefined,
) => {
  if (isAbortError(cause)) return cause;
  if (signal?.aborted) return signal.reason ?? cause;
  return undefined;
};

const searchFailure = (
  cause: unknown,
  signal: AbortSignal | undefined,
  message: string,
): unknown =>
  resolveAbort(cause, signal) ?? new WebSearchError(message, { cause });

export const createOllamaWebSearchBackend = (
  options: OllamaWebSearchOptions,
): WebSearchBackend => {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  const url = `${baseUrl}/api/web_search`;

  const buildHeaders = (): Headers => {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${options.apiKey}`);
    headers.set("Content-Type", "application/json");
    return headers;
  };

  return {
    name: "ollama",
    async search(request, context) {
      context.signal?.throwIfAborted();

      const doFetch = options.fetch ?? globalThis.fetch;

      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers: buildHeaders(),
          body: JSON.stringify({
            query: request.query,
            max_results: request.maxResults,
          }),
          signal: context.signal,
        });
      } catch (cause) {
        throw searchFailure(
          cause,
          context.signal,
          "Ollama web search request failed to send",
        );
      }

      if (!response.ok) {
        let detail = "";
        try {
          const text = await response.text();
          detail = `: ${Array.from(text).slice(0, ERROR_BODY_SNIPPET_CHARS).join("")}`;
        } catch (cause) {
          const abort = resolveAbort(cause, context.signal);
          if (abort !== undefined) throw abort;
        }
        throw new WebSearchError(
          `Ollama web search request failed: ${response.status}${detail}`,
        );
      }

      let text: string;
      try {
        text = await response.text();
      } catch (cause) {
        throw searchFailure(
          cause,
          context.signal,
          "Ollama web search response failed to read",
        );
      }

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch (cause) {
        throw new WebSearchError(
          "Ollama web search response is not JSON",
          {
            cause,
          },
        );
      }

      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) {
        throw new WebSearchError(
          "Ollama web search response has an unexpected shape",
          { cause: parsed.error },
        );
      }

      return parsed.data.results.map((result): WebSearchResult => ({
        title: result.title,
        url: result.url,
        snippet: result.content,
      }));
    },
  };
};
