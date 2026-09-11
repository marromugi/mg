import { ProviderHttpError, ProviderTransportError } from "../errors.js";
import type {
  GenerateRequest,
  GenerateResponse,
  Provider,
  StreamEvent,
} from "../types.js";
import { fromOpenRouterResponse, toOpenRouterRequest } from "./convert.js";

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

  const generate = async (
    request: GenerateRequest,
  ): Promise<GenerateResponse> => {
    const doFetch = options.fetch ?? globalThis.fetch;

    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${options.apiKey}`);
    headers.set("Content-Type", "application/json");

    const requestBody = JSON.stringify(toOpenRouterRequest(request, false));

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

  const stream = (_request: GenerateRequest): AsyncIterable<StreamEvent> => {
    throw new Error("not implemented");
  };

  return { generate, stream };
};
