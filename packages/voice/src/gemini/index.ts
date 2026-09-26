import type { AudioChunk } from "../audio.js";
import type {
  SpeechOptions,
  SpeechSynthesizer,
} from "../synthesizer.js";
import {
  GeminiSpeechHttpError,
  GeminiSpeechResponseError,
  GeminiSpeechTransportError,
  isGeminiSpeechError,
} from "./errors.js";
import { readGeminiSseData } from "./sse.js";

export {
  GeminiSpeechHttpError,
  GeminiSpeechResponseError,
  GeminiSpeechTransportError,
  isGeminiSpeechError,
} from "./errors.js";
export type { GeminiSpeechError } from "./errors.js";

const NAME = "gemini";
const DEFAULT_MODEL = "gemini-3.8-flash-tts";
const DEFAULT_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";

const isAbortError = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  (cause as { name?: unknown }).name === "AbortError";

// signal が中断すると、読みかけの reader.read() を待たずに、
// 中断の理由でストリームを終えます。読んでいる側には例外として届きます。
const withAbort = (
  raw: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): ReadableStream<Uint8Array> => {
  const reader = raw.getReader();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = (): void => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  const cleanup = (): void => {
    if (onAbort !== undefined)
      signal.removeEventListener("abort", onAbort);
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await Promise.race([
          reader.read(),
          aborted,
        ]);
        if (done) {
          cleanup();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (cause) {
        cleanup();
        controller.error(cause);
        reader.cancel().catch(() => {});
      }
    },
    cancel(reason) {
      cleanup();
      return reader.cancel(reason);
    },
  });
};

const decodeBase64 = (data: string): Uint8Array =>
  Uint8Array.from(Buffer.from(data, "base64"));

const parseGeminiSpeechEvent = (payload: string): AudioChunk => {
  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch (cause) {
    throw new GeminiSpeechResponseError(
      "Gemini speech response is not JSON",
      { cause },
    );
  }

  const parts = (
    body as {
      candidates?: { content?: { parts?: unknown[] } }[];
    }
  )?.candidates?.[0]?.content?.parts;

  const part = Array.isArray(parts)
    ? parts.find(
        (candidate): candidate is { inlineData: unknown } =>
          typeof candidate === "object" &&
          candidate !== null &&
          typeof (candidate as { inlineData?: unknown }).inlineData ===
            "object" &&
          (candidate as { inlineData: unknown }).inlineData !== null,
      )
    : undefined;

  if (part === undefined) {
    throw new GeminiSpeechResponseError(
      "Gemini speech response has no audio in an event",
    );
  }

  const inlineData = part.inlineData as {
    mimeType?: unknown;
    data?: unknown;
  };
  if (typeof inlineData.mimeType !== "string") {
    throw new GeminiSpeechResponseError(
      "Gemini speech response has an audio part with no mime type",
    );
  }
  if (typeof inlineData.data !== "string") {
    throw new GeminiSpeechResponseError(
      "Gemini speech response has an audio part with no data",
    );
  }
  const { mimeType, data } = inlineData;

  const mainType = mimeType.split(";")[0]?.trim().toLowerCase();
  if (mainType !== "audio/l16") {
    throw new GeminiSpeechResponseError(
      `Gemini speech response has an unsupported audio type: ${mimeType}`,
    );
  }

  const rateMatch = /rate=(\d+)/.exec(mimeType);
  if (rateMatch === null) {
    throw new GeminiSpeechResponseError(
      `Gemini speech response has an unreadable rate: ${mimeType}`,
    );
  }
  const channelsMatch = /channels=(\d+)/.exec(mimeType);

  return {
    format: {
      encoding: "pcm-s16le",
      sampleRate: Number(rateMatch[1]),
      channels: channelsMatch !== null ? Number(channelsMatch[1]) : 1,
    },
    data: decodeBase64(data),
  };
};

export type GeminiSynthesizerOptions = {
  apiKey: string;
  voice: string;
  language?: string;
  speakingRate?: number;
  model?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

export const createGeminiSynthesizer = (
  options: GeminiSynthesizerOptions,
): SpeechSynthesizer => {
  if (options.language === "") {
    throw new RangeError("language must not be empty");
  }
  if (options.speakingRate !== undefined) {
    throw new Error(
      "speakingRate is not supported: the Gemini speech API has no field for it",
    );
  }

  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  const model = options.model ?? DEFAULT_MODEL;
  const url = `${baseUrl}/models/${model}:streamGenerateContent?alt=sse`;

  const buildHeaders = (): Headers => {
    const headers = new Headers(options.headers);
    headers.set("x-goog-api-key", options.apiKey);
    headers.set("Content-Type", "application/json");
    return headers;
  };

  const buildBody = (text: string): string =>
    JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: options.voice },
          },
          ...(options.language !== undefined && {
            languageCode: options.language,
          }),
        },
      },
    });

  async function* synthesize(
    text: string,
    speechOptions?: SpeechOptions,
  ): AsyncGenerator<AudioChunk> {
    const signal = speechOptions?.signal;
    const doFetch = options.fetch ?? globalThis.fetch;

    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: buildHeaders(),
        body: buildBody(text),
        ...(signal !== undefined && { signal }),
      });
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      throw new GeminiSpeechTransportError(
        "Gemini speech request failed to send",
        { cause },
      );
    }

    if (!response.ok) {
      let bodyText: string;
      try {
        bodyText = await response.text();
      } catch (cause) {
        if (isAbortError(cause)) throw cause;
        throw new GeminiSpeechTransportError(
          "Gemini speech response failed to read",
          { cause },
        );
      }
      throw new GeminiSpeechHttpError(
        `Gemini speech request failed: ${response.status}`,
        response.status,
        bodyText,
      );
    }

    const body = response.body;
    if (body === null) {
      throw new GeminiSpeechHttpError(
        "Gemini speech response has no body",
        response.status,
        "",
      );
    }

    const readableBody =
      signal === undefined ? body : withAbort(body, signal);

    let count = 0;
    try {
      for await (const payload of readGeminiSseData(readableBody)) {
        yield parseGeminiSpeechEvent(payload);
        count++;
      }
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      if (isGeminiSpeechError(cause)) throw cause;
      throw new GeminiSpeechTransportError(
        "Gemini speech response failed to read",
        { cause },
      );
    }

    if (count === 0) {
      throw new GeminiSpeechResponseError(
        "Gemini speech response ended without audio",
      );
    }
  }

  return { name: NAME, synthesize };
};
