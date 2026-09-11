import { describe, expect, test } from "vitest";
import { readSseData } from "./sse.js";

const encoder = new TextEncoder();

function streamOf(...chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const payloads: string[] = [];
  for await (const payload of readSseData(stream)) {
    payloads.push(payload);
  }
  return payloads;
}

describe("readSseData", () => {
  test("yields one event per chunk", async () => {
    const stream = streamOf('data: {"n":1}\n\n', 'data: {"n":2}\n\n', 'data: {"n":3}\n\n');

    await expect(collect(stream)).resolves.toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
  });

  test("yields two events arriving in one chunk", async () => {
    const stream = streamOf('data: {"n":1}\n\ndata: {"n":2}\n\n');

    await expect(collect(stream)).resolves.toEqual(['{"n":1}', '{"n":2}']);
  });

  test("rejoins one event split across three chunks mid-line and mid-character", async () => {
    const bytes = encoder.encode('data: {"t":"こんにちは"}\n\n');
    const stream = streamOf(bytes.slice(0, 3), bytes.slice(3, 13), bytes.slice(13));

    await expect(collect(stream)).resolves.toEqual(['{"t":"こんにちは"}']);
  });

  test("skips comment lines", async () => {
    const stream = streamOf(
      ": OPENROUTER PROCESSING\n\n",
      ":\n",
      'data: {"n":1}\n\n',
      ": OPENROUTER PROCESSING\n\n",
      'data: {"n":2}\n\n',
    );

    await expect(collect(stream)).resolves.toEqual(['{"n":1}', '{"n":2}']);
  });

  test("accepts CRLF line endings", async () => {
    const stream = streamOf(': OPENROUTER PROCESSING\r\n\r\ndata: {"n":1}\r\n\r\ndata: {"n":2}\r\n\r\n');

    await expect(collect(stream)).resolves.toEqual(['{"n":1}', '{"n":2}']);
  });

  test("joins multi-line data within one event", async () => {
    const stream = streamOf("data: first\ndata: second\n\ndata: third\n\n");

    await expect(collect(stream)).resolves.toEqual(["first\nsecond", "third"]);
  });

  test("strips only a single space after the prefix", async () => {
    const stream = streamOf("data:  padded\n\ndata:tight\n\n");

    await expect(collect(stream)).resolves.toEqual([" padded", "tight"]);
  });

  test("stops at the done marker and yields nothing after it", async () => {
    const stream = streamOf('data: {"n":1}\n\n', "data: [DONE]\n\n", 'data: {"n":2}\n\n');

    await expect(collect(stream)).resolves.toEqual(['{"n":1}']);
  });

  test("yields the last buffered event when the stream ends without a done marker", async () => {
    const stream = streamOf('data: {"n":1}\n\n', 'data: {"n":2}');

    await expect(collect(stream)).resolves.toEqual(['{"n":1}', '{"n":2}']);
  });

  test("propagates an error from the underlying stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"n":1}\n\n'));
        controller.error(new Error("connection reset"));
      },
    });

    await expect(collect(stream)).rejects.toThrow("connection reset");
  });
});
