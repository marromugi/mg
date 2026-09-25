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

const HALTED = "halted" as const;

// fetch が signal を見ない実装でも止まるよう、読み込みの reader を直接取り消します。
const withHalt = (
  body: ReadableStream<Uint8Array>,
  halt: AbortSignal,
): ReadableStream<Uint8Array> => {
  const reader = body.getReader();
  const onAbort = (): void => {
    reader.cancel().catch(() => {});
  };
  if (halt.aborted) {
    onAbort();
  } else {
    halt.addEventListener("abort", onAbort, { once: true });
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          halt.removeEventListener("abort", onAbort);
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (cause) {
        halt.removeEventListener("abort", onAbort);
        if (halt.aborted) {
          controller.close();
          return;
        }
        controller.error(cause);
      }
    },
    cancel(reason) {
      halt.removeEventListener("abort", onAbort);
      return reader.cancel(reason);
    },
  });
};

type BodyReadOutcome = { text: string } | typeof HALTED;

const readGenerateBody = async (
  response: Response,
  halt: AbortSignal | undefined,
): Promise<BodyReadOutcome> => {
  const body = response.body;
  if (body === null || halt === undefined) {
    try {
      return { text: await response.text() };
    } catch (cause) {
      throw transportFailure(cause, "Ollama response failed to read");
    }
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let halted = false;
  const onAbort = (): void => {
    halted = true;
    reader.cancel().catch(() => {});
  };
  if (halt.aborted) {
    onAbort();
  } else {
    halt.addEventListener("abort", onAbort, { once: true });
  }

  try {
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    if (halted) {
      return HALTED;
    }
    return { text: text + decoder.decode() };
  } catch (cause) {
    if (halted) {
      return HALTED;
    }
    throw transportFailure(cause, "Ollama response failed to read");
  } finally {
    halt.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
};

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

  const send = async (
    requestBody: string,
    halt?: AbortSignal,
  ): Promise<Response | typeof HALTED> => {
    const doFetch = options.fetch ?? globalThis.fetch;

    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: buildHeaders(),
        body: requestBody,
        ...(halt !== undefined && { signal: halt }),
      });
    } catch (cause) {
      if (halt?.aborted === true && isAbortError(cause)) {
        return HALTED;
      }
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
    if (request.halt?.aborted === true) {
      return { parts: [], finishReason: "halted" };
    }

    const sent = await send(
      JSON.stringify(toOllamaRequest(request, false, options)),
      request.halt,
    );
    if (sent === HALTED) {
      return { parts: [], finishReason: "halted" };
    }
    const response = sent;

    const outcome = await readGenerateBody(response, request.halt);
    if (outcome === HALTED) {
      return { parts: [], finishReason: "halted" };
    }
    const { text } = outcome;

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
    if (request.halt?.aborted === true) {
      yield { type: "finish", finishReason: "halted" };
      return;
    }

    const sent = await send(
      JSON.stringify(toOllamaRequest(request, true, options)),
      request.halt,
    );
    if (sent === HALTED) {
      yield { type: "finish", finishReason: "halted" };
      return;
    }
    const response = sent;

    const body = response.body;
    if (body === null) {
      throw new ProviderHttpError(
        "Ollama response has no body",
        response.status,
        "",
      );
    }

    const readableBody =
      request.halt === undefined ? body : withHalt(body, request.halt);

    yield* toStreamEvents(readLines(readableBody), request.halt);
  }

  const stream = (
    request: GenerateRequest,
  ): AsyncIterable<StreamEvent> => runStream(request);

  return { name: "ollama", generate, stream };
};
