import { describe, expect, test } from "vitest";
import { createIrodoriSynthesizer } from "./index.js";

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
  voice: "none",
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

const collect = async <T>(iterable: AsyncIterable<T>): Promise<T[]> => {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
};

describe("createIrodoriSynthesizer", () => {
  test("sends the tone as the caption of every request", async () => {
    const { fetchStub, calls } = stubFetch(
      () =>
        new Response(
          join(wavHeader(24000, 1, 2), new Uint8Array([1, 0])),
        ),
    );
    const synthesizer = createIrodoriSynthesizer({
      ...options(fetchStub),
      tone: "落ち着いた低めの声。",
    });

    await collect(synthesizer.synthesize("one"));
    await collect(synthesizer.synthesize("two"));

    expect(calls[0].url).toBe("http://speech.test/v1/audio/speech");
    expect(
      calls.map((call) => JSON.parse(String(call.init?.body))),
    ).toEqual([
      {
        model: "irodori-tts",
        input: "one",
        voice: "none",
        response_format: "wav",
        irodori: { caption: "落ち着いた低めの声。" },
      },
      {
        model: "irodori-tts",
        input: "two",
        voice: "none",
        response_format: "wav",
        irodori: { caption: "落ち着いた低めの声。" },
      },
    ]);
  });

  test("sends no irodori options when no tone is given", async () => {
    const { fetchStub, calls } = stubFetch(
      () =>
        new Response(
          join(wavHeader(24000, 1, 2), new Uint8Array([1, 0])),
        ),
    );
    const synthesizer = createIrodoriSynthesizer(options(fetchStub));

    await collect(synthesizer.synthesize("one"));

    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      model: "irodori-tts",
      input: "one",
      voice: "none",
      response_format: "wav",
    });
  });

  test.each(["", "  \n"])(
    "throws RangeError at creation for the tone %j, sending nothing",
    (tone) => {
      const { fetchStub, calls } = stubFetch(() => new Response(""));
      expect(() =>
        createIrodoriSynthesizer({ ...options(fetchStub), tone }),
      ).toThrow(RangeError);
      expect(calls).toHaveLength(0);
    },
  );
});
