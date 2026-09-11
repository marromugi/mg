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

const readText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch (cause) {
    throw transportFailure(cause, "OpenRouter response failed to read");
  }
};

async function* readPayloads(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<string> {
  if (body === null) return;
  try {
    yield* readSseData(body);
  } catch (cause) {
    throw transportFailure(cause, "OpenRouter stream failed to read");
  }
}

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

  const send = async (
    request: GenerateRequest,
    stream: boolean,
  ): Promise<Response> => {
    const doFetch = options.fetch ?? globalThis.fetch;

    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${options.apiKey}`);
    headers.set("Content-Type", "application/json");

    const requestBody = JSON.stringify(toOpenRouterRequest(request, stream));

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: requestBody,
      });
    } catch (cause) {
      throw transportFailure(cause, "OpenRouter request failed to send");
    }

    if (!response.ok) {
      const text = await readText(response);
      throw new ProviderHttpError(
        `OpenRouter request failed: ${response.status}`,
        response.status,
        text,
      );
    }

    return response;
  };

  const generate = async (
    request: GenerateRequest,
  ): Promise<GenerateResponse> => {
    const response = await send(request, false);
    const text = await readText(response);

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

  async function* stream(request: GenerateRequest): AsyncGenerator<StreamEvent> {
    const response = await send(request, true);
    yield* toStreamEvents(readPayloads(response.body));
  }

  return { generate, stream };
};
