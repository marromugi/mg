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

// signal が中断すると、待っている promise を待たずに終えます。
// 中断の理由で拒否します。signal がなければ何もしません。
// 中断に負けた promise の値は、discard に渡して捨てます。
const raceAbort = <T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  discard?: (late: T) => void,
): Promise<T> => {
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    let lost = false;
    const onAbort = (): void => {
      lost = true;
      reject(signal.reason);
    };
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (lost) discard?.(value);
        else resolve(value);
      },
      (cause: unknown) => {
        signal.removeEventListener("abort", onAbort);
        if (!lost) reject(cause);
      },
    );
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
};

// signal が中断すると、読みかけの reader.read() を待たずに、
// 中断の理由でストリームを終えます。
// 読んでいる側には例外として届きます。
const withAbort = (
  raw: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): ReadableStream<Uint8Array> => {
  const reader = raw.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await raceAbort(reader.read(), signal);
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (cause) {
        controller.error(cause);
        reader.cancel().catch(() => {});
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
};

const decodeBase64 = (data: string): Uint8Array =>
  Uint8Array.from(Buffer.from(data, "base64"));

type GeminiSpeechEvent = { chunk?: AudioChunk; finishReason?: string };

const parseGeminiSpeechEvent = (payload: string): GeminiSpeechEvent => {
  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch (cause) {
    throw new GeminiSpeechResponseError(
      "Gemini speech response is not JSON",
      { cause },
    );
  }

  const candidate = (
    body as {
      candidates?: {
        content?: { parts?: unknown[] };
        finishReason?: unknown;
      }[];
    }
  )?.candidates?.[0];

  const finishReason =
    typeof candidate?.finishReason === "string"
      ? candidate.finishReason
      : undefined;

  const parts = candidate?.content?.parts;
  const part = Array.isArray(parts)
    ? parts.find(
        (candidatePart): candidatePart is { inlineData: unknown } =>
          typeof candidatePart === "object" &&
          candidatePart !== null &&
          typeof (candidatePart as { inlineData?: unknown })
            .inlineData === "object" &&
          (candidatePart as { inlineData: unknown }).inlineData !==
            null,
      )
    : undefined;

  if (part === undefined) {
    if (finishReason === undefined) {
      throw new GeminiSpeechResponseError(
        "Gemini speech response has no audio in an event",
      );
    }
    return { finishReason };
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
    chunk: {
      format: {
        encoding: "pcm-s16le",
        sampleRate: Number(rateMatch[1]),
        channels: channelsMatch !== null ? Number(channelsMatch[1]) : 1,
      },
      data: decodeBase64(data),
    },
    finishReason,
  };
};

export type GeminiSynthesizerOptions = {
  apiKey: string;
  voice: string;
  language?: string;
  speakingRate?: number;
  tone?: string;
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
  if (options.tone !== undefined && options.tone.trim() === "") {
    throw new RangeError("tone must not be empty");
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
      contents: [
        {
          parts: [
            {
              text,
              ...(options.tone !== undefined && {
                annotations: [
                  {
                    type: "speech_metadata",
                    style: options.tone.trim(),
                  },
                ],
              }),
            },
          ],
        },
      ],
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

    signal?.throwIfAborted();

    let response: Response;
    try {
      response = await raceAbort(
        doFetch(url, {
          method: "POST",
          headers: buildHeaders(),
          body: buildBody(text),
          ...(signal !== undefined && { signal }),
        }),
        signal,
        (late) => {
          late.body?.cancel().catch(() => {});
        },
      );
    } catch (cause) {
      if (signal?.aborted) throw signal.reason;
      if (isAbortError(cause)) throw cause;
      throw new GeminiSpeechTransportError(
        "Gemini speech request failed to send",
        { cause },
      );
    }

    if (!response.ok) {
      let bodyText: string;
      try {
        bodyText = await (signal === undefined || response.body === null
          ? response.text()
          : new Response(withAbort(response.body, signal)).text());
      } catch (cause) {
        if (signal?.aborted) {
          throw new GeminiSpeechHttpError(
            `Gemini speech request failed: ${response.status} (body not read: the call was stopped)`,
            response.status,
            "",
          );
        }
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
        const event = parseGeminiSpeechEvent(payload);
        if (event.chunk !== undefined) {
          signal?.throwIfAborted();
          yield event.chunk;
          count++;
        }
        signal?.throwIfAborted();
        if (event.finishReason === "STOP") {
          if (count === 0) {
            throw new GeminiSpeechResponseError(
              "Gemini speech response ended without audio",
            );
          }
          return;
        }
        if (event.finishReason !== undefined) {
          throw new GeminiSpeechResponseError(
            `Gemini speech response stopped: ${event.finishReason}`,
          );
        }
      }
    } catch (cause) {
      if (signal?.aborted) throw signal.reason;
      if (isAbortError(cause)) throw cause;
      if (isGeminiSpeechError(cause)) throw cause;
      throw new GeminiSpeechTransportError(
        "Gemini speech response failed to read",
        { cause },
      );
    }

    signal?.throwIfAborted();
    if (count === 0) {
      throw new GeminiSpeechResponseError(
        "Gemini speech response ended without audio",
      );
    }
  }

  return { name: NAME, synthesize };
};
