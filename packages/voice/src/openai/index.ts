import type { AudioChunk, AudioFormat } from "../audio.js";
import type {
  SpeechOptions,
  SpeechSynthesizer,
} from "../synthesizer.js";
import {
  OpenAiSpeechHttpError,
  OpenAiSpeechResponseError,
  OpenAiSpeechTransportError,
  isOpenAiSpeechError,
} from "./errors.js";
import { parseWavHeader } from "./wav.js";

export {
  OpenAiSpeechHttpError,
  OpenAiSpeechResponseError,
  OpenAiSpeechTransportError,
  isOpenAiSpeechError,
} from "./errors.js";
export type { OpenAiSpeechError } from "./errors.js";

const NAME = "openai";

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

const describeCause = (cause: unknown): string => {
  const inner = (cause as { cause?: unknown } | null)?.cause;
  const source = inner ?? cause;
  const code = (source as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  return source instanceof Error ? source.message : String(source);
};

// The server's own message: the text of an OpenAI-style
// `{ error: { message } }`, a `{ detail }` string, or else the body.
const serverMessage = (body: string): string => {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown } | string;
      detail?: unknown;
      message?: unknown;
    } | null;
    const error = parsed?.error;
    const text =
      typeof error === "string"
        ? error
        : typeof error?.message === "string"
          ? error.message
          : typeof parsed?.detail === "string"
            ? parsed.detail
            : typeof parsed?.message === "string"
              ? parsed.message
              : undefined;
    if (text !== undefined) return text.trim();
  } catch {
    // Not JSON: the body is the message.
  }
  return body.trim();
};

export type OpenAiSynthesizerOptions = {
  baseUrl: string;
  model: string;
  voice: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

export const createOpenAiSynthesizer = (
  options: OpenAiSynthesizerOptions,
): SpeechSynthesizer => {
  const url = `${options.baseUrl.replace(/\/+$/, "")}/audio/speech`;

  const buildHeaders = (): Headers => {
    const headers = new Headers(options.headers);
    if (options.apiKey !== undefined) {
      headers.set("Authorization", `Bearer ${options.apiKey}`);
    }
    headers.set("Content-Type", "application/json");
    return headers;
  };

  const buildBody = (text: string): string =>
    JSON.stringify({
      model: options.model,
      input: text,
      voice: options.voice,
      response_format: "wav",
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
      throw new OpenAiSpeechTransportError(
        `OpenAI speech request could not be sent to ${url} (${describeCause(cause)})`,
        { cause },
      );
    }

    const reader = response.body?.getReader();

    // Reads the next piece of the body. undefined at its end.
    const readNext = async (): Promise<Uint8Array | undefined> => {
      if (reader === undefined) return undefined;
      const { value, done } = await raceAbort(reader.read(), signal);
      return done ? undefined : value;
    };

    try {
      if (!response.ok) {
        let bodyText = "";
        try {
          const parts: Uint8Array[] = [];
          for (let part = await readNext(); part !== undefined;) {
            parts.push(part);
            part = await readNext();
          }
          bodyText = new TextDecoder().decode(Buffer.concat(parts));
        } catch (cause) {
          if (signal?.aborted) {
            throw new OpenAiSpeechHttpError(
              `OpenAI speech request failed: ${response.status} (body not read: the call was stopped)`,
              response.status,
              "",
            );
          }
          if (isAbortError(cause)) throw cause;
          throw new OpenAiSpeechTransportError(
            "OpenAI speech response could not be read",
            { cause },
          );
        }
        const message = serverMessage(bodyText);
        throw new OpenAiSpeechHttpError(
          message === ""
            ? `OpenAI speech request failed: ${response.status}`
            : `OpenAI speech request failed: ${response.status} ${message}`,
          response.status,
          bodyText,
        );
      }

      if (reader === undefined) {
        throw new OpenAiSpeechHttpError(
          "OpenAI speech response has no body",
          response.status,
          "",
        );
      }

      let header = new Uint8Array(0);
      let format: AudioFormat | undefined;
      let remaining = Infinity;
      // Bytes of the last piece that do not yet make a whole frame.
      let carry = new Uint8Array(0);
      let sent = 0;

      const frame = (): number => (format?.channels ?? 1) * 2;

      for (;;) {
        const part = await readNext();
        signal?.throwIfAborted();
        if (part === undefined) break;

        let data: Uint8Array;
        if (format === undefined) {
          const joined = new Uint8Array(header.length + part.length);
          joined.set(header);
          joined.set(part, header.length);
          const parsed = parseWavHeader(joined);
          if (parsed === undefined) {
            header = joined;
            continue;
          }
          format = parsed.format;
          remaining = parsed.dataLength ?? Infinity;
          data = joined.subarray(parsed.dataStart);
          header = new Uint8Array(0);
        } else {
          data = part;
        }

        if (data.length > remaining) data = data.subarray(0, remaining);
        remaining -= data.length;

        const joined = new Uint8Array(carry.length + data.length);
        joined.set(carry);
        joined.set(data, carry.length);
        const whole = joined.length - (joined.length % frame());
        carry = joined.slice(whole);
        if (whole > 0) {
          yield { format, data: joined.slice(0, whole) };
          sent += whole;
          signal?.throwIfAborted();
        }
        if (remaining === 0) break;
      }

      if (format === undefined) {
        throw new OpenAiSpeechResponseError(
          header.length === 0
            ? "OpenAI speech response has no audio: the body is empty"
            : "OpenAI speech response ended before the WAV header was complete",
        );
      }
      if (sent === 0) {
        throw new OpenAiSpeechResponseError(
          "OpenAI speech response ended without audio",
        );
      }
    } catch (cause) {
      if (signal?.aborted) throw signal.reason;
      if (isAbortError(cause)) throw cause;
      if (isOpenAiSpeechError(cause)) throw cause;
      throw new OpenAiSpeechTransportError(
        "OpenAI speech response could not be read",
        { cause },
      );
    } finally {
      reader?.cancel().catch(() => {});
    }

    signal?.throwIfAborted();
  }

  return { name: NAME, synthesize };
};
