import { describe, expect, test } from "vitest";
import { readNdjsonLines } from "./ndjson.js";

const encoder = new TextEncoder();

function streamOf(
  ...chunks: Array<string | Uint8Array>
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === "string" ? encoder.encode(chunk) : chunk,
        );
      }
      controller.close();
    },
  });
}

function openStreamOf(...chunks: Array<string | Uint8Array>): {
  stream: ReadableStream<Uint8Array>;
  cancelled: () => boolean;
} {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === "string" ? encoder.encode(chunk) : chunk,
        );
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

async function collect(
  stream: ReadableStream<Uint8Array>,
): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of readNdjsonLines(stream)) {
    lines.push(line);
  }
  return lines;
}

describe("readNdjsonLines", () => {
  test("yields a single line", async () => {
    const stream = streamOf('{"n":1}\n');

    await expect(collect(stream)).resolves.toEqual(['{"n":1}']);
  });

  test("yields several lines arriving in one chunk", async () => {
    const stream = streamOf('{"n":1}\n{"n":2}\n{"n":3}\n');

    await expect(collect(stream)).resolves.toEqual([
      '{"n":1}',
      '{"n":2}',
      '{"n":3}',
    ]);
  });

  test("rejoins one line split across three chunks", async () => {
    const stream = streamOf('{"n"', ":", "1}\n");

    await expect(collect(stream)).resolves.toEqual(['{"n":1}']);
  });

  test("rejoins a multibyte character split across chunks", async () => {
    const bytes = encoder.encode('{"t":"こんにちは"}\n');
    const stream = streamOf(
      bytes.slice(0, 3),
      bytes.slice(3, 13),
      bytes.slice(13),
    );

    await expect(collect(stream)).resolves.toEqual([
      '{"t":"こんにちは"}',
    ]);
  });

  test("accepts CRLF line endings", async () => {
    const stream = streamOf('{"n":1}\r\n{"n":2}\r\n');

    await expect(collect(stream)).resolves.toEqual([
      '{"n":1}',
      '{"n":2}',
    ]);
  });

  test("skips blank lines", async () => {
    const stream = streamOf('{"n":1}\n\n\n{"n":2}\n');

    await expect(collect(stream)).resolves.toEqual([
      '{"n":1}',
      '{"n":2}',
    ]);
  });

  test("yields the last line when it has no trailing newline", async () => {
    const stream = streamOf('{"n":1}\n{"n":2}');

    await expect(collect(stream)).resolves.toEqual([
      '{"n":1}',
      '{"n":2}',
    ]);
  });

  test("releases the reader lock once the stream ends", async () => {
    const stream = streamOf('{"n":1}\n');

    await collect(stream);

    expect(stream.locked).toBe(false);
  });

  test("cancels the stream when the caller stops reading early", async () => {
    const { stream, cancelled } = openStreamOf('{"n":1}\n{"n":2}\n');

    const seen: string[] = [];
    for await (const line of readNdjsonLines(stream)) {
      seen.push(line);
      break;
    }

    expect(seen).toEqual(['{"n":1}']);
    expect(cancelled()).toBe(true);
    expect(stream.locked).toBe(false);
  });

  test("propagates an error from the underlying stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"n":1}\n'));
        controller.error(new Error("connection reset"));
      },
    });

    await expect(collect(stream)).rejects.toThrow("connection reset");
  });
});
