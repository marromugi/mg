import { ProviderHttpError } from "../errors.js";
import type {
  GenerateRequest,
  GenerateResponse,
  Provider,
  StreamEvent,
} from "../types.js";
import { fromOpenRouterResponse, toOpenRouterRequest } from "./convert.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

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

    const response = await doFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(toOpenRouterRequest(request, false)),
    });

    const text = await response.text();

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
