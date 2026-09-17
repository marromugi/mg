import {
  ProviderHttpError,
  ProviderTransportError,
} from "../errors.js";
import { readNdjsonLines } from "../ndjson.js";
import type {
  GenerateRequest,
  GenerateResponse,
  Provider,
  StreamEvent,
} from "../types.js";
import {
  fromOllamaResponse,
  toOllamaRequest,
  type OllamaRequestOptions,
} from "./convert.js";
import { toStreamEvents } from "./stream.js";

const DEFAULT_BASE_URL = "http://localhost:11434";

const isAbortError = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  (cause as { name?: unknown }).name === "AbortError";

const transportFailure = (cause: unknown, message: string): unknown =>
  isAbortError(cause)
    ? cause
    : new ProviderTransportError(message, { cause });

export type OllamaOptions = OllamaRequestOptions & {
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

export const createOllamaProvider = (
  options: OllamaOptions = {},
): Provider => {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  const url = `${baseUrl}/api/chat`;

  const buildHeaders = (): Headers => {
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");
    return headers;
  };

  const send = async (requestBody: string): Promise<Response> => {
    const doFetch = options.fetch ?? globalThis.fetch;

    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: buildHeaders(),
        body: requestBody,
      });
    } catch (cause) {
      throw transportFailure(cause, "Ollama request failed to send");
    }

    if (!response.ok) {
      let text: string;
      try {
        text = await response.text();
      } catch (cause) {
        throw transportFailure(cause, "Ollama response failed to read");
      }
      throw new ProviderHttpError(
        `Ollama request failed: ${response.status}`,
        response.status,
        text,
      );
    }

    return response;
  };

  const generate = async (
    request: GenerateRequest,
  ): Promise<GenerateResponse> => {
    const response = await send(
      JSON.stringify(toOllamaRequest(request, false, options)),
    );

    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      throw transportFailure(cause, "Ollama response failed to read");
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ProviderHttpError(
        "Ollama response is not JSON",
        response.status,
        text,
      );
    }

    return fromOllamaResponse(body);
  };

  async function* readLines(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<string> {
    try {
      yield* readNdjsonLines(body);
    } catch (cause) {
      throw transportFailure(cause, "Ollama response failed to read");
    }
  }

  async function* runStream(
    request: GenerateRequest,
  ): AsyncGenerator<StreamEvent> {
    const response = await send(
      JSON.stringify(toOllamaRequest(request, true, options)),
    );

    const body = response.body;
    if (body === null) {
      throw new ProviderHttpError(
        "Ollama response has no body",
        response.status,
        "",
      );
    }

    yield* toStreamEvents(readLines(body));
  }

  const stream = (
    request: GenerateRequest,
  ): AsyncIterable<StreamEvent> => runStream(request);

  return { name: "ollama", generate, stream };
};
