import type { AudioChunk, AudioFormat } from "../audio.js";
import type {
  TranscribeOptions,
  Transcriber,
  TranscriptEvent,
} from "../transcriber.js";
import {
  GeminiTranscriptionResponseError,
  GeminiTranscriptionTransportError,
} from "./errors.js";

export {
  GeminiTranscriptionResponseError,
  GeminiTranscriptionTransportError,
  isGeminiTranscriptionError,
} from "./errors.js";
export type { GeminiTranscriptionError } from "./errors.js";

const NAME = "gemini";
const DEFAULT_MODEL = "gemini-3.5-transcribe-live";
const DEFAULT_BASE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const ACCEPTED_FORMAT: AudioFormat = {
  encoding: "pcm-s16le",
  sampleRate: 16000,
  channels: 1,
};

export type GeminiTranscriberOptions = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  WebSocket?: typeof WebSocket;
};

type Item =
  | { kind: "event"; event: TranscriptEvent }
  | { kind: "error"; error: unknown }
  | { kind: "done" };

// Items are read in the order they were put in; the first error or done ends it.
const createMailbox = () => {
  const items: Item[] = [];
  let waiting: ((item: Item) => void) | undefined;
  let ended = false;

  const put = (item: Item) => {
    if (ended) return;
    if (item.kind !== "event") ended = true;
    if (waiting !== undefined) {
      const resolve = waiting;
      waiting = undefined;
      resolve(item);
    } else {
      items.push(item);
    }
  };

  return {
    event: (event: TranscriptEvent) => put({ kind: "event", event }),
    fail: (error: unknown) => put({ kind: "error", error }),
    done: () => put({ kind: "done" }),
    next: (): Promise<Item> => {
      const item = items.shift();
      if (item !== undefined) return Promise.resolve(item);
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
  };
};

const STOP: unique symbol = Symbol("stop");

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const describeFormat = (format: AudioFormat) =>
  `${format.encoding}, ${format.sampleRate} Hz, ${format.channels} channels`;

const sameFormat = (a: AudioFormat, b: AudioFormat) =>
  a.encoding === b.encoding &&
  a.sampleRate === b.sampleRate &&
  a.channels === b.channels;

const checkFormat = (format: AudioFormat) => {
  if (!sameFormat(format, ACCEPTED_FORMAT)) {
    throw new RangeError(
      `unsupported audio format: ${describeFormat(format)}; accepted: ${describeFormat(ACCEPTED_FORMAT)}`,
    );
  }
};

const decoder = new TextDecoder();

const decodeFrame = (data: unknown): string => {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return decoder.decode(data);
  }
  throw new GeminiTranscriptionResponseError(
    "Gemini sent a message that is neither text nor binary",
  );
};

const toBase64 = (data: Uint8Array) =>
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
    "base64",
  );

type ServerMessage = {
  serverContent?: {
    interimInputTranscription?: { text?: string };
    inputTranscription?: { text?: string };
    generationComplete?: boolean;
  };
};

export const createGeminiTranscriber = (
  options: GeminiTranscriberOptions,
): Transcriber => {
  const model = options.model ?? DEFAULT_MODEL;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const WebSocketConstructor =
    options.WebSocket ?? globalThis.WebSocket;

  async function* transcribe(
    audio: AsyncIterable<AudioChunk>,
    callOptions: TranscribeOptions = {},
  ): AsyncGenerator<TranscriptEvent, void, undefined> {
    const { signal, languages } = callOptions;
    for (const code of languages ?? []) Intl.getCanonicalLocales(code);
    signal?.throwIfAborted();

    const mailbox = createMailbox();
    const iterator = audio[Symbol.asyncIterator]();
    let socket: WebSocket | undefined;
    const stopped = deferred();
    const until = <T>(promise: Promise<T>): Promise<T | typeof STOP> =>
      Promise.race([
        promise,
        stopped.promise.then((): typeof STOP => STOP),
      ]);

    const onAbort = () => mailbox.fail(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });

    const send = (message: unknown) => {
      try {
        socket?.send(JSON.stringify(message));
      } catch (cause) {
        throw new GeminiTranscriptionTransportError(
          "failed to send to Gemini",
          { cause },
        );
      }
    };

    const connect = () => {
      const opened = deferred();
      const ready = deferred();
      const url = new URL(baseUrl);
      url.searchParams.set("key", options.apiKey);
      const ws = new WebSocketConstructor(url.href);
      ws.binaryType = "arraybuffer";
      socket = ws;
      let held: string | undefined;
      let connectionError: unknown;

      ws.addEventListener("open", () => opened.resolve());
      ws.addEventListener("error", (event) => {
        connectionError = event;
      });
      ws.addEventListener("close", (event) => {
        const { code, reason } = event;
        mailbox.fail(
          new GeminiTranscriptionTransportError(
            `Gemini session closed before the transcription finished: code ${code}, reason "${reason}"`,
            { code, reason, cause: connectionError },
          ),
        );
      });
      ws.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(
            decodeFrame(event.data),
          ) as ServerMessage | null;
          if (message === null || typeof message !== "object") {
            throw new GeminiTranscriptionResponseError(
              "Gemini sent a message that is not an object",
            );
          }
          if ("setupComplete" in message) ready.resolve();
          const content = message.serverContent;
          const interim = content?.interimInputTranscription;
          if (interim !== undefined) {
            mailbox.event({
              type: "partial",
              text: interim.text ?? "",
            });
          }
          const finished = content?.inputTranscription;
          if (finished !== undefined) {
            if (held !== undefined) {
              throw new GeminiTranscriptionResponseError(
                "Gemini sent a second completed transcription before generation complete",
              );
            }
            held = finished.text ?? "";
          }
          if (content?.generationComplete === true) {
            mailbox.event({ type: "final", text: held ?? "" });
            mailbox.done();
          }
        } catch (cause) {
          mailbox.fail(
            cause instanceof GeminiTranscriptionResponseError
              ? cause
              : new GeminiTranscriptionResponseError(
                  "Gemini sent a message that is not valid JSON",
                  { cause },
                ),
          );
        }
      });
      return { opened: opened.promise, ready: ready.promise };
    };

    const pump = async () => {
      const first = await until(iterator.next());
      if (first === STOP) return;
      if (first.done === true) {
        mailbox.event({ type: "final", text: "" });
        mailbox.done();
        return;
      }
      checkFormat(first.value.format);

      const { opened, ready } = connect();
      if ((await until(opened)) === STOP) return;
      send({
        setup: {
          model: `models/${model}`,
          inputAudioTranscription:
            languages !== undefined && languages.length > 0
              ? { languageCodes: [...languages] }
              : {},
          realtimeInputConfig: {
            automaticActivityDetection: { disabled: true },
          },
        },
      });
      if ((await until(ready)) === STOP) return;
      send({ realtimeInput: { activityStart: {} } });

      let chunk: IteratorResult<AudioChunk> | typeof STOP = first;
      while (chunk !== STOP && chunk.done !== true) {
        send({
          realtimeInput: {
            audio: {
              data: toBase64(chunk.value.data),
              mimeType: `audio/pcm;rate=${chunk.value.format.sampleRate}`,
            },
          },
        });
        chunk = await until(iterator.next());
        if (chunk !== STOP && chunk.done !== true) {
          checkFormat(chunk.value.format);
        }
      }
      if (chunk === STOP) return;
      send({ realtimeInput: { activityEnd: {} } });
    };

    pump().catch((error: unknown) => mailbox.fail(error));

    try {
      for (;;) {
        const item = await mailbox.next();
        if (item.kind === "event") yield item.event;
        else if (item.kind === "error") throw item.error;
        else return;
      }
    } finally {
      stopped.resolve();
      signal?.removeEventListener("abort", onAbort);
      socket?.close();
      try {
        const returned: unknown = iterator.return?.();
        if (returned instanceof Promise)
          returned.catch(() => undefined);
      } catch {
        // The audio stream's own failure is not the call's to report.
      }
    }
  }

  return { name: NAME, accepts: [ACCEPTED_FORMAT], transcribe };
};
