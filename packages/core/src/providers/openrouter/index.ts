import { ProviderHttpError, ProviderTransportError } from "../errors.js";
import type {
  GenerateRequest,
  GenerateResponse,
  Provider,
  StreamEvent,
} from "../types.js";
import { readSseData } from "../sse.js";
import { fromOpenRouterResponse, toOpenRouterRequest } from "./convert.js";
import { toStreamEvents } from "./stream.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

const isAbortError = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  (cause as { name?: unknown }).name === "AbortError";

const transportFailure = (cause: unknown, message: string): unknown =>
  isAbortError(cause) ? cause : new ProviderTransportError(message, { cause });

export type OpenRouterOptions = {
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

export const createOpenRouterProvider = (
  options: OpenRouterOptions,
): Provider => {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const url = `${baseUrl}/chat/completions`;

  const buildHeaders = (): Headers => {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${options.apiKey}`);
    headers.set("Content-Type", "application/json");
    return headers;
  };

  const generate = async (
    request: GenerateRequest,
  ): Promise<GenerateResponse> => {
    const doFetch = options.fetch ?? globalThis.fetch;

    const headers = buildHeaders();

    const requestBody = JSON.stringify(toOpenRouterRequest(request, false));

    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers,
        body: requestBody,
      });
    } catch (cause) {
      throw transportFailure(cause, "OpenRouter request failed to send");
    }

    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      throw transportFailure(cause, "OpenRouter response failed to read");
    }

    if (!response.ok) {
      throw new ProviderHttpError(
        `OpenRouter request failed: ${response.status}`,
        response.status,
        text,
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ProviderHttpError(
        "OpenRouter response is not JSON",
        response.status,
        text,
      );
    }

    return fromOpenRouterResponse(body);
  };

  async function* readPayloads(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<string> {
    try {
      yield* readSseData(body);
    } catch (cause) {
      throw transportFailure(cause, "OpenRouter response failed to read");
    }
  }

  async function* runStream(
    request: GenerateRequest,
  ): AsyncGenerator<StreamEvent> {
    const doFetch = options.fetch ?? globalThis.fetch;

    const headers = buildHeaders();

    const requestBody = JSON.stringify({
      ...toOpenRouterRequest(request, true),
      stream_options: { include_usage: true },
    });

    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers,
        body: requestBody,
      });
    } catch (cause) {
      throw transportFailure(cause, "OpenRouter request failed to send");
    }

    if (!response.ok) {
      let text: string;
      try {
        text = await response.text();
      } catch (cause) {
        throw transportFailure(cause, "OpenRouter response failed to read");
      }
      throw new ProviderHttpError(
        `OpenRouter request failed: ${response.status}`,
        response.status,
        text,
      );
    }

    const body = response.body;
    if (body === null) {
      throw new ProviderHttpError(
        "OpenRouter response has no body",
        response.status,
        "",
      );
    }

    yield* toStreamEvents(readPayloads(body));
  }

  const stream = (request: GenerateRequest): AsyncIterable<StreamEvent> =>
    runStream(request);

  return { generate, stream };
};
