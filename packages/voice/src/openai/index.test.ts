import { describe, expect, test } from "vitest";
import {
  OpenAiSpeechHttpError,
  OpenAiSpeechResponseError,
  OpenAiSpeechTransportError,
  createOpenAiSynthesizer,
  isOpenAiSpeechError,
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

const options = (fetchStub: typeof fetch) => ({
  baseUrl: "http://speech.test/v1",
  model: "tts-1",
  voice: "alloy",
  fetch: fetchStub,
});

// A 16-bit PCM WAV header. `dataLength` is what the header declares.
const wavHeader = (
  sampleRate: number,
  channels: number,
  dataLength: number,
  extra: Uint8Array = new Uint8Array(0),
): Uint8Array<ArrayBuffer> => {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(Math.min(36 + dataLength, 0xffffffff), 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return new Uint8Array(
    Buffer.concat([header.subarray(0, 36), extra, header.subarray(36)]),
  );
};

const join = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.concat(parts));

const streamOf = (pieces: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(piece);
      controller.close();
    },
  });

const collect = async <T>(iterable: AsyncIterable<T>): Promise<T[]> => {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
};

const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );

describe("createOpenAiSynthesizer", () => {
  test("sends the tone in the instructions field of every request", async () => {
    const { fetchStub, calls } = stubFetch(
      () =>
        new Response(
          join(wavHeader(24000, 1, 2), new Uint8Array([1, 0])),
        ),
    );
    const synthesizer = createOpenAiSynthesizer({
      ...options(fetchStub),
      tone: "in a low voice, slowly",
    });

    await collect(synthesizer.synthesize("one"));
    await collect(synthesizer.synthesize("two"));

    expect(
      calls.map((call) => JSON.parse(String(call.init?.body))),
    ).toEqual([
      {
        model: "tts-1",
        input: "one",
        voice: "alloy",
        response_format: "wav",
        instructions: "in a low voice, slowly",
      },
      {
        model: "tts-1",
        input: "two",
        voice: "alloy",
        response_format: "wav",
        instructions: "in a low voice, slowly",
      },
    ]);
  });

  test.each(["", "  \n"])(
    "throws RangeError at creation for the tone %j, sending nothing",
    (tone) => {
      const { fetchStub, calls } = stubFetch(() => new Response(""));
      expect(() =>
        createOpenAiSynthesizer({ ...options(fetchStub), tone }),
      ).toThrow(RangeError);
      expect(calls).toHaveLength(0);
    },
  );

  test("sends the model, text, voice and wav as JSON to the speech path, with no Authorization without a key", async () => {
    const { fetchStub, calls } = stubFetch(
      () =>
        new Response(
          join(wavHeader(24000, 1, 2), new Uint8Array([1, 0])),
        ),
    );
    const synthesizer = createOpenAiSynthesizer(options(fetchStub));

    await collect(synthesizer.synthesize("こんにちは"));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://speech.test/v1/audio/speech");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      model: "tts-1",
      input: "こんにちは",
      voice: "alloy",
      response_format: "wav",
    });
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBeNull();
  });

  test("sends the key as a bearer token when one is given", async () => {
    const { fetchStub, calls } = stubFetch(
      () =>
        new Response(
          join(wavHeader(24000, 1, 2), new Uint8Array([1, 0])),
        ),
    );
    const synthesizer = createOpenAiSynthesizer({
      ...options(fetchStub),
      apiKey: "secret",
    });

    await collect(synthesizer.synthesize("a"));

    expect(
      new Headers(calls[0].init?.headers).get("authorization"),
    ).toBe("Bearer secret");
  });

  test("yields the samples in the header's format when the body arrives in uneven pieces", async () => {
    const samples = new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0]);
    const whole = join(wavHeader(48000, 1, 8), samples);
    // The header is split mid-way, and a sample is split across pieces.
    const pieces = [
      whole.subarray(0, 10),
      whole.subarray(10, 47),
      whole.subarray(47, 49),
      whole.subarray(49),
    ];
    const { fetchStub } = stubFetch(
      () => new Response(streamOf(pieces)),
    );
    const synthesizer = createOpenAiSynthesizer(options(fetchStub));

    const chunks = await collect(synthesizer.synthesize("a"));

    expect(chunks.map((chunk) => Array.from(chunk.data))).toEqual([
      [1, 0],
      [2, 0],
      [3, 0, 4, 0],
    ]);
    expect(chunks.map((chunk) => chunk.format)).toEqual([
      { encoding: "pcm-s16le", sampleRate: 48000, channels: 1 },
      { encoding: "pcm-s16le", sampleRate: 48000, channels: 1 },
      { encoding: "pcm-s16le", sampleRate: 48000, channels: 1 },
    ]);
  });

  test("keeps stereo samples whole as frames of 4 bytes", async () => {
    const whole = join(
      wavHeader(24000, 2, 8),
      new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0]),
    );
    const { fetchStub } = stubFetch(
      () =>
        new Response(
          streamOf([whole.subarray(0, 49), whole.subarray(49)]),
        ),
    );
    const synthesizer = createOpenAiSynthesizer(options(fetchStub));

    const chunks = await collect(synthesizer.synthesize("a"));

    expect(chunks.map((chunk) => Array.from(chunk.data))).toEqual([
      [1, 0, 2, 0],
      [3, 0, 4, 0],
    ]);
    expect(chunks[0].format.channels).toBe(2);
  });

  test.each([0, 0xffffffff])(
    "reads to the end of the body when the header declares a data length of %i",
    async (declared) => {
      const { fetchStub } = stubFetch(
        () =>
          new Response(
            join(
              wavHeader(48000, 1, declared),
              new Uint8Array([1, 0, 2, 0, 3, 0]),
            ),
          ),
      );
      const synthesizer = createOpenAiSynthesizer(options(fetchStub));

      const chunks = await collect(synthesizer.synthesize("a"));

      expect(
        Array.from(Buffer.concat(chunks.map((chunk) => chunk.data))),
      ).toEqual([1, 0, 2, 0, 3, 0]);
    },
  );

  test("finds the samples after a chunk that sits between fmt and data", async () => {
    const extra = new Uint8Array([
      ...Buffer.from("LIST"),
      4,
      0,
      0,
      0,
      9,
      9,
      9,
      9,
    ]);
    const { fetchStub } = stubFetch(
      () =>
        new Response(
          join(wavHeader(48000, 1, 2, extra), new Uint8Array([7, 0])),
        ),
    );
    const synthesizer = createOpenAiSynthesizer(options(fetchStub));

    const chunks = await collect(synthesizer.synthesize("a"));

    expect(chunks.map((chunk) => Array.from(chunk.data))).toEqual([
      [7, 0],
    ]);
  });

  test("throws an HTTP error whose message has the status and the server's message", async () => {
    const { fetchStub } = stubFetch(
      () =>
        new Response(
          JSON.stringify({ error: { message: " model not found " } }),
          { status: 404 },
        ),
    );
    const synthesizer = createOpenAiSynthesizer(options(fetchStub));

    const error = await failureOf(collect(synthesizer.synthesize("a")));

    expect(error).toBeInstanceOf(OpenAiSpeechHttpError);
    expect(isOpenAiSpeechError(error)).toBe(true);
    expect((error as OpenAiSpeechHttpError).status).toBe(404);
    expect((error as OpenAiSpeechHttpError).message).toBe(
      "OpenAI speech request failed: 404 model not found",
    );
  });

  test("puts a plain-text failure body into the message trimmed", async () => {
    const { fetchStub } = stubFetch(
      () => new Response("  busy\n", { status: 503 }),
    );
    const synthesizer = createOpenAiSynthesizer(options(fetchStub));

    const error = await failureOf(collect(synthesizer.synthesize("a")));

    expect((error as OpenAiSpeechHttpError).message).toBe(
      "OpenAI speech request failed: 503 busy",
    );
    expect((error as OpenAiSpeechHttpError).body).toBe("  busy\n");
  });

  test("throws a transport error with the cause when the request cannot be sent", async () => {
    const cause = new TypeError("fetch failed");
    const fetchStub: typeof fetch = async () => {
      throw cause;
    };
    const synthesizer = createOpenAiSynthesizer(options(fetchStub));

    const error = await failureOf(collect(synthesizer.synthesize("a")));

    expect(error).toBeInstanceOf(OpenAiSpeechTransportError);
    expect((error as OpenAiSpeechTransportError).message).toBe(
      "OpenAI speech request could not be sent to http://speech.test/v1/audio/speech (fetch failed)",
    );
    expect((error as OpenAiSpeechTransportError).cause).toBe(cause);
  });

  test("throws a response error naming the format when the WAV is not 16-bit PCM", async () => {
    const header = wavHeader(48000, 1, 4);
    // Format code 3 (float) with 32 bits per sample.
    header[20] = 3;
    header[34] = 32;
    const { fetchStub } = stubFetch(
      () => new Response(join(header, new Uint8Array(4))),
    );
    const synthesizer = createOpenAiSynthesizer(options(fetchStub));

    const error = await failureOf(collect(synthesizer.synthesize("a")));

    expect(error).toBeInstanceOf(OpenAiSpeechResponseError);
    expect((error as OpenAiSpeechResponseError).message).toBe(
      "OpenAI speech response is not 16-bit PCM WAV: received format code 3 with 32 bits per sample",
    );
  });

  test("throws a response error when the body is not WAV", async () => {
    const { fetchStub } = stubFetch(
      () => new Response("ID3 this is an mp3 stream"),
    );
    const synthesizer = createOpenAiSynthesizer(options(fetchStub));

    const error = await failureOf(collect(synthesizer.synthesize("a")));

    expect(error).toBeInstanceOf(OpenAiSpeechResponseError);
    expect((error as OpenAiSpeechResponseError).message).toBe(
      "OpenAI speech response is not 16-bit PCM WAV: it does not start with RIFF and WAVE (first bytes: 49 44 33 20 74 68 69 73 20 69 73 20)",
    );
  });

  test("throws a response error when the WAV has no samples", async () => {
    const { fetchStub } = stubFetch(
      () => new Response(wavHeader(48000, 1, 0)),
    );
    const synthesizer = createOpenAiSynthesizer(options(fetchStub));

    const error = await failureOf(collect(synthesizer.synthesize("a")));

    expect((error as OpenAiSpeechResponseError).message).toBe(
      "OpenAI speech response ended without audio",
    );
  });

  test("throws the signal's reason and sends no request when the signal has fired before the call", async () => {
    const { fetchStub, calls } = stubFetch(() => new Response(""));
    const synthesizer = createOpenAiSynthesizer(options(fetchStub));
    const reason = new Error("stop");

    const error = await failureOf(
      collect(
        synthesizer.synthesize("a", {
          signal: AbortSignal.abort(reason),
        }),
      ),
    );

    expect(error).toBe(reason);
    expect(calls).toHaveLength(0);
  });

  test("throws the signal's reason, not the audio read so far, when the signal fires while the body is open", async () => {
    let push: ((piece: Uint8Array) => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (piece) => controller.enqueue(piece);
      },
    });
    const { fetchStub } = stubFetch(() => new Response(body));
    const synthesizer = createOpenAiSynthesizer(options(fetchStub));
    const controller = new AbortController();
    const reason = new Error("stop");

    const chunks = synthesizer.synthesize("a", {
      signal: controller.signal,
    });
    const iterator = chunks[Symbol.asyncIterator]();
    push?.(join(wavHeader(48000, 1, 0), new Uint8Array([1, 0])));
    const first = await iterator.next();
    const pending = failureOf(iterator.next());
    controller.abort(reason);

    expect(Array.from(first.value.data)).toEqual([1, 0]);
    expect(await pending).toBe(reason);
  });

  test("throws the HTTP error with an empty body when the signal fires while a failure body is being read", async () => {
    let markPulled: () => void = () => {};
    const pulled = new Promise<void>((resolve) => {
      markPulled = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      pull() {
        markPulled();
        return new Promise(() => {});
      },
    });
    const { fetchStub } = stubFetch(
      () => new Response(body, { status: 401 }),
    );
    const synthesizer = createOpenAiSynthesizer(options(fetchStub));
    const controller = new AbortController();

    const pending = failureOf(
      collect(
        synthesizer.synthesize("a", { signal: controller.signal }),
      ),
    );
    await pulled;
    controller.abort({ why: "user" });
    const error = await pending;

    expect(error).toBeInstanceOf(OpenAiSpeechHttpError);
    expect((error as OpenAiSpeechHttpError).status).toBe(401);
    expect((error as OpenAiSpeechHttpError).body).toBe("");
    expect((error as OpenAiSpeechHttpError).message).toBe(
      "OpenAI speech request failed: 401 (body not read: the call was stopped)",
    );
  });

  test("throws the signal's reason when the signal fires while waiting for the response", async () => {
    const fetchStub: typeof fetch = () =>
      new Promise<Response>(() => {});
    const synthesizer = createOpenAiSynthesizer(options(fetchStub));
    const controller = new AbortController();
    const reason = new Error("stop");

    const pending = failureOf(
      collect(
        synthesizer.synthesize("a", { signal: controller.signal }),
      ),
    );
    controller.abort(reason);

    expect(await pending).toBe(reason);
  });
});
