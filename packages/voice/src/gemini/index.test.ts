import { describe, expect, test } from "vitest";
import {
  GeminiSpeechHttpError,
  GeminiSpeechResponseError,
  GeminiSpeechTransportError,
  createGeminiSynthesizer,
  isGeminiSpeechError,
} from "./index.js";

type Call = { url: string; init: RequestInit | undefined };

const stubFetch = (respond: () => Response) => {
  const calls: Call[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return respond();
  };
  return { fetchStub, calls };
};

const throwingFetch = (error: unknown) => {
  const calls: Call[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    throw error;
  };
  return { fetchStub, calls };
};

const encoder = new TextEncoder();

const audioEvent = (
  bytesBase64: string,
  rate: number,
  finishReason?: string,
) => ({
  candidates: [
    {
      content: {
        parts: [
          {
            inlineData: {
              mimeType: `audio/L16;codec=pcm;rate=${rate}`,
              data: bytesBase64,
            },
          },
        ],
      },
      ...(finishReason !== undefined && { finishReason }),
    },
  ],
});

const textFinishEvent = (text: string, finishReason: string) => ({
  candidates: [
    {
      content: { parts: [{ text }] },
      finishReason,
    },
  ],
});

const finishOnlyEvent = (finishReason: string) => ({
  candidates: [{ finishReason }],
});

// テストからイベントを送るタイミングを自分で決められる SSE の本文です。
const controlledSseBody = () => {
  let push: ((chunk: Uint8Array) => void) | undefined;
  let end: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (chunk) => controller.enqueue(chunk);
      end = () => controller.close();
    },
  });
  return {
    stream,
    send: (payload: unknown) =>
      push?.(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)),
    close: () => end?.(),
  };
};

const collect = async <T>(iterable: AsyncIterable<T>): Promise<T[]> => {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
};

describe("createGeminiSynthesizer", () => {
  test("streams chunks in the order sent without waiting for the whole response", async () => {
    const { stream, send, close } = controlledSseBody();
    const { fetchStub } = stubFetch(
      () => new Response(stream, { status: 200 }),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    const chunks = synthesizer.synthesize("text");
    const iterator = chunks[Symbol.asyncIterator]();

    send(audioEvent("AQ==", 24000));
    const first = await iterator.next();

    // 3 つ目は、1 つ目の断片を受け取ったあとに送ります。
    send(audioEvent("Ag==", 24000));
    send(audioEvent("Aw==", 24000));
    close();
    const second = await iterator.next();
    const third = await iterator.next();
    const done = await iterator.next();

    expect(Array.from(first.value.data)).toEqual([1]);
    expect(Array.from(second.value.data)).toEqual([2]);
    expect(Array.from(third.value.data)).toEqual([3]);
    expect(done.done).toBe(true);
  });

  test("declares 16-bit little-endian PCM at the rate the response declared", async () => {
    const { fetchStub } = stubFetch(
      () =>
        new Response(
          `data: ${JSON.stringify(audioEvent("AQ==", 24000))}\n\n`,
          { status: 200 },
        ),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    const [chunk] = await collect(synthesizer.synthesize("text"));

    expect(chunk.format).toEqual({
      encoding: "pcm-s16le",
      sampleRate: 24000,
      channels: 1,
    });
  });

  test("carries the rate the response declared when it differs", async () => {
    const { fetchStub } = stubFetch(
      () =>
        new Response(
          `data: ${JSON.stringify(audioEvent("AQ==", 16000))}\n\n`,
          { status: 200 },
        ),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    const [chunk] = await collect(synthesizer.synthesize("text"));

    expect(chunk.format.sampleRate).toBe(16000);
  });

  test("decodes the base64 audio into its raw bytes", async () => {
    const { fetchStub } = stubFetch(
      () =>
        new Response(
          `data: ${JSON.stringify(audioEvent("AQID", 24000))}\n\n`,
          { status: 200 },
        ),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    const [chunk] = await collect(synthesizer.synthesize("text"));

    expect(Array.from(chunk.data)).toEqual([1, 2, 3]);
  });

  test("becomes an error carrying the status and body when the response reports failure", async () => {
    const { fetchStub } = stubFetch(
      () => new Response("quota", { status: 429 }),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    const error = await collect(synthesizer.synthesize("text")).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(GeminiSpeechHttpError);
    expect(isGeminiSpeechError(error)).toBe(true);
    expect((error as GeminiSpeechHttpError).status).toBe(429);
    expect((error as GeminiSpeechHttpError).body).toBe("quota");
  });

  test("becomes an error carrying the cause when sending fails", async () => {
    const thrown = new Error("network down");
    const { fetchStub } = throwingFetch(thrown);
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    const error = await collect(synthesizer.synthesize("text")).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(GeminiSpeechTransportError);
    expect((error as GeminiSpeechTransportError).cause).toBe(thrown);
  });

  test("becomes a response-shape error when an event has no audio", async () => {
    const { fetchStub } = stubFetch(
      () =>
        new Response(
          `data: ${JSON.stringify({ candidates: [{}] })}\n\n`,
          {
            status: 200,
          },
        ),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    const error = await collect(synthesizer.synthesize("text")).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(GeminiSpeechResponseError);
    expect((error as Error).message).toBe(
      "Gemini speech response has no audio in an event",
    );
  });

  test("becomes a response-shape error when the audio type is unsupported", async () => {
    const { fetchStub } = stubFetch(
      () =>
        new Response(
          `data: ${JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "audio/mpeg",
                        data: "AQ==",
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\n`,
          { status: 200 },
        ),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    const error = await collect(synthesizer.synthesize("text")).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(GeminiSpeechResponseError);
    expect((error as Error).message).toBe(
      "Gemini speech response has an unsupported audio type: audio/mpeg",
    );
  });

  test("becomes a response-shape error when the stream ends without any event", async () => {
    const { fetchStub } = stubFetch(
      () => new Response("", { status: 200 }),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    const error = await collect(synthesizer.synthesize("text")).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(GeminiSpeechResponseError);
    expect((error as Error).message).toBe(
      "Gemini speech response ended without audio",
    );
  });

  test("throws the abort reason unchanged when interrupted after the first chunk", async () => {
    const { stream, send } = controlledSseBody();
    const { fetchStub } = stubFetch(
      () => new Response(stream, { status: 200 }),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });
    const controller = new AbortController();

    const chunks = synthesizer.synthesize("text", {
      signal: controller.signal,
    });
    const iterator = chunks[Symbol.asyncIterator]();

    send(audioEvent("AQ==", 24000));
    await iterator.next();
    controller.abort();

    const error = await iterator
      .next()
      .catch((caught: unknown) => caught);

    expect((error as Error).name).toBe("AbortError");
  });

  test("sends the api key header and the text and voice in the body", async () => {
    const { fetchStub, calls } = stubFetch(
      () => new Response("", { status: 200 }),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    await collect(synthesizer.synthesize("こんにちは。")).catch(
      () => {},
    );

    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("x-goog-api-key")).toBe("k");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.contents[0].parts[0].text).toBe("こんにちは。");
    expect(
      body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig
        .voiceName,
    ).toBe("Kore");
  });

  test("sends the default model and URL when both are omitted", async () => {
    const { fetchStub, calls } = stubFetch(
      () => new Response("", { status: 200 }),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    await collect(synthesizer.synthesize("text")).catch(() => {});

    expect(calls[0].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:streamGenerateContent?alt=sse",
    );
  });

  test("sends the given language in the request body", async () => {
    const { fetchStub, calls } = stubFetch(
      () => new Response("", { status: 200 }),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      language: "ja-JP",
      fetch: fetchStub,
    });

    await collect(synthesizer.synthesize("text")).catch(() => {});

    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.generationConfig.speechConfig.languageCode).toBe(
      "ja-JP",
    );
  });

  test("sends no language field when the language is omitted", async () => {
    const { fetchStub, calls } = stubFetch(
      () => new Response("", { status: 200 }),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    await collect(synthesizer.synthesize("text")).catch(() => {});

    const body = JSON.parse(String(calls[0].init?.body));
    expect(
      Object.hasOwn(body.generationConfig.speechConfig, "languageCode"),
    ).toBe(false);
  });

  test("rejects an empty language at construction without sending anything", async () => {
    const { fetchStub, calls } = stubFetch(
      () => new Response("", { status: 200 }),
    );

    expect(() =>
      createGeminiSynthesizer({
        apiKey: "k",
        voice: "Kore",
        language: "",
        fetch: fetchStub,
      }),
    ).toThrow(new RangeError("language must not be empty"));
    expect(calls).toHaveLength(0);
  });

  test("rejects a speaking rate at construction without sending anything", async () => {
    const { fetchStub, calls } = stubFetch(
      () => new Response("", { status: 200 }),
    );

    expect(() =>
      createGeminiSynthesizer({
        apiKey: "k",
        voice: "Kore",
        speakingRate: 1.2,
        fetch: fetchStub,
      }),
    ).toThrow(
      new Error(
        "speakingRate is not supported: the Gemini speech API has no field for it",
      ),
    );
    expect(calls).toHaveLength(0);
  });

  test("carries the declared rate and channel count when the mime type uses lowercase and spaces", async () => {
    const { fetchStub } = stubFetch(
      () =>
        new Response(
          `data: ${JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "audio/l16; rate=24000; channels=1",
                        data: "AQ==",
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\n`,
          { status: 200 },
        ),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    const [chunk] = await collect(synthesizer.synthesize("text"));

    expect(chunk.format).toEqual({
      encoding: "pcm-s16le",
      sampleRate: 24000,
      channels: 1,
    });
  });

  test("stops after a STOP event without yielding its non-audio parts or reading further", async () => {
    const { stream, send, close } = controlledSseBody();
    const { fetchStub } = stubFetch(
      () => new Response(stream, { status: 200 }),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    send(audioEvent("AQ==", 24000));
    send(audioEvent("Ag==", 24000));
    send(textFinishEvent("こんにちは。", "STOP"));
    send(audioEvent("Aw==", 24000));
    close();

    const chunks = await collect(synthesizer.synthesize("text"));

    expect(chunks).toHaveLength(2);
    expect(Array.from(chunks[0].data)).toEqual([1]);
    expect(Array.from(chunks[1].data)).toEqual([2]);
  });

  test("becomes a response-shape error naming the finish reason after yielding that event's audio", async () => {
    const { stream, send, close } = controlledSseBody();
    const { fetchStub } = stubFetch(
      () => new Response(stream, { status: 200 }),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    send(audioEvent("AQ==", 24000));
    send(finishOnlyEvent("SAFETY"));
    close();

    const chunks: Uint8Array[] = [];
    const error = await (async () => {
      try {
        for await (const chunk of synthesizer.synthesize("text")) {
          chunks.push(chunk.data);
        }
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(chunks).toHaveLength(1);
    expect(error).toBeInstanceOf(GeminiSpeechResponseError);
    expect((error as Error).message).toBe(
      "Gemini speech response stopped: SAFETY",
    );
  });

  test("becomes a response-shape error ending without audio when the only event is a STOP with no audio", async () => {
    const { fetchStub } = stubFetch(
      () =>
        new Response(
          `data: ${JSON.stringify(finishOnlyEvent("STOP"))}\n\n`,
          { status: 200 },
        ),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    const error = await collect(synthesizer.synthesize("text")).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(GeminiSpeechResponseError);
    expect((error as Error).message).toBe(
      "Gemini speech response ended without audio",
    );
  });

  test("becomes a response-shape error naming the finish reason after yielding the audio in the same event", async () => {
    const { fetchStub } = stubFetch(
      () =>
        new Response(
          `data: ${JSON.stringify(
            audioEvent("AQ==", 24000, "MAX_TOKENS"),
          )}\n\n`,
          { status: 200 },
        ),
    );
    const synthesizer = createGeminiSynthesizer({
      apiKey: "k",
      voice: "Kore",
      fetch: fetchStub,
    });

    const chunks: Uint8Array[] = [];
    const error = await (async () => {
      try {
        for await (const chunk of synthesizer.synthesize("text")) {
          chunks.push(chunk.data);
        }
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(chunks).toHaveLength(1);
    expect(error).toBeInstanceOf(GeminiSpeechResponseError);
    expect((error as Error).message).toBe(
      "Gemini speech response stopped: MAX_TOKENS",
    );
  });
});
