import {
  ProviderRequestError,
  ProviderResponseError,
} from "../errors.js";
import {
  OpenRouterHttpError,
  unusableOpenRouterResponse,
} from "./http-error.js";
import type {
  GenerateRequest,
  GenerateResponse,
  Provider,
  StreamEvent,
} from "../types.js";
import { readSseData } from "../sse.js";
import {
  fromOpenRouterResponse,
  toOpenRouterRequest,
} from "./convert.js";
import { PROVIDER_NAME } from "./name.js";
import {
  bodyReadFailureMark,
  sendFailureMark,
  statusMark,
  type RetryMark,
} from "../retry-mark.js";
import { toStreamEvents } from "./stream.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

const isAbortError = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  (cause as { name?: unknown }).name === "AbortError";

const requestFailure = (
  cause: unknown,
  message: string,
  mark: RetryMark,
): unknown =>
  isAbortError(cause)
    ? cause
    : new ProviderRequestError(message, { cause, ...mark });

// 応答の本文を読み切れなかったときの失敗です。
// 接続が切れたなら応答が来なかったことで、再試行できます。
const bodyReadFailure = (cause: unknown): unknown => {
  if (isAbortError(cause)) return cause;
  const message = "OpenRouter response body could not be read";
  const mark = bodyReadFailureMark(cause);
  return mark.retryable
    ? new ProviderRequestError(message, { cause, ...mark })
    : new ProviderResponseError(message, { cause });
};

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
      throw bodyReadFailure(cause);
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
    throw bodyReadFailure(cause);
  } finally {
    halt.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
};

export { OpenRouterHttpError };

export type OpenRouterOptions = {
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  newToolCallId?: () => string;
};

export const createOpenRouterProvider = (
  options: OpenRouterOptions,
): Provider & { toolForcing: true } => {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  const url = `${baseUrl}/chat/completions`;
  const newToolCallId =
    options.newToolCallId ?? (() => globalThis.crypto.randomUUID());

  const buildHeaders = (): Headers => {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${options.apiKey}`);
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
      throw requestFailure(
        cause,
        "OpenRouter request failed to send",
        sendFailureMark(cause),
      );
    }

    if (!response.ok) {
      let text: string;
      try {
        text = await response.text();
      } catch (cause) {
        throw requestFailure(
          cause,
          `OpenRouter request failed: ${response.status}; the body could not be read`,
          statusMark(response),
        );
      }
      throw new ProviderRequestError(
        `OpenRouter request failed: ${response.status}`,
        {
          cause: new OpenRouterHttpError(response.status, text),
          ...(text !== "" && { causeQuotesService: true as const }),
          ...statusMark(response),
        },
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

    const { body: requestBody, omitted } = toOpenRouterRequest(
      request,
      false,
    );
    const sent = await send(JSON.stringify(requestBody), request.halt);
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
    } catch (cause) {
      throw unusableOpenRouterResponse(
        "OpenRouter response is not JSON",
        response.status,
        text,
        cause,
      );
    }

    const generated = fromOpenRouterResponse(body, newToolCallId);
    return omitted.length === 0 ? generated : { ...generated, omitted };
  };

  async function* readPayloads(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<string> {
    try {
      yield* readSseData(body);
    } catch (cause) {
      throw bodyReadFailure(cause);
    }
  }

  async function* runStream(
    request: GenerateRequest,
  ): AsyncGenerator<StreamEvent> {
    if (request.halt?.aborted === true) {
      yield { type: "finish", finishReason: "halted" };
      return;
    }

    const { body: requestBody, omitted } = toOpenRouterRequest(
      request,
      true,
    );
    const sent = await send(JSON.stringify(requestBody), request.halt);
    if (sent === HALTED) {
      yield { type: "finish", finishReason: "halted" };
      return;
    }
    const response = sent;

    const body = response.body;
    if (body === null) {
      throw new ProviderResponseError(
        "OpenRouter response has no body",
      );
    }

    const readableBody =
      request.halt === undefined ? body : withHalt(body, request.halt);

    for await (const event of toStreamEvents(
      readPayloads(readableBody),
      newToolCallId,
      request.halt,
    )) {
      yield event.type === "finish" && omitted.length > 0
        ? { ...event, omitted }
        : event;
    }
  }

  const stream = (
    request: GenerateRequest,
  ): AsyncIterable<StreamEvent> => runStream(request);

  return { name: PROVIDER_NAME, toolForcing: true, generate, stream };
};
