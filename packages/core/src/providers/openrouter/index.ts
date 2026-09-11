import { ProviderError } from "../errors.js";
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
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = options.fetch ?? globalThis.fetch;

  const generate = async (
    request: GenerateRequest,
  ): Promise<GenerateResponse> => {
    const response = await doFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      body: JSON.stringify(toOpenRouterRequest(request, false)),
    });

    if (!response.ok) {
      throw new ProviderError(
        `OpenRouter request failed: ${response.status}`,
        response.status,
        await response.text(),
      );
    }

    return fromOpenRouterResponse(await response.json());
  };

  const stream = (_request: GenerateRequest): AsyncIterable<StreamEvent> => {
    throw new Error("not implemented");
  };

  return { generate, stream };
};
