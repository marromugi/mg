import { afterEach, describe, expect, test, vi } from "vitest";
import { createHostClient, HostRequestError } from "./index.js";
import type { ReplyRecord } from "./index.js";

const record = (cursor: number, text = `r${cursor}`): ReplyRecord => ({
  cursor,
  conversationId: "discord:a",
  inputId: `i${cursor}`,
  kind: "reply",
  text,
});

const ndjson = (records: ReplyRecord[]): Response =>
  new Response(records.map((r) => `${JSON.stringify(r)}\n`).join(""), {
    headers: { "content-type": "application/x-ndjson" },
  });

/** A stream that sends `records`, then stays open until aborted. */
const open = (
  records: ReplyRecord[],
  signal: AbortSignal | null | undefined,
): Response => {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const r of records) {
          controller.enqueue(encoder.encode(`${JSON.stringify(r)}\n`));
        }
        signal?.addEventListener("abort", () => {
          controller.error(new DOMException("aborted", "AbortError"));
        });
      },
    }),
  );
};

const urls: string[] = [];
const fakeFetch =
  (
    ...answers: Array<
      (init: RequestInit) => Response | Promise<Response>
    >
  ) =>
  (input: RequestInfo | URL, init: RequestInit = {}) => {
    urls.push(String(input));
    const answer = answers[urls.length - 1];
    if (answer === undefined) {
      return Promise.reject(new Error("no more answers"));
    }
    return Promise.resolve(answer(init));
  };

afterEach(() => {
  urls.length = 0;
  vi.useRealTimers();
});

describe("replies", () => {
  test("asks for the named conversations from the cursor, with the token", async () => {
    let seen: RequestInit = {};
    const client = createHostClient({
      url: "http://host.test/",
      token: "secret",
      fetch: fakeFetch((init) => {
        seen = init;
        return ndjson([record(8)]);
      }),
    });

    const replies = client.replies({
      after: 7,
      conversations: ["x", "y"],
      prefix: "discord:",
    });
    const iterator = replies[Symbol.asyncIterator]();
    const first = await iterator.next();

    expect(urls[0]).toBe(
      "http://host.test/replies?after=7&conversation=x&conversation=y&prefix=discord%3A",
    );
    expect(seen.headers).toEqual({ authorization: "Bearer secret" });
    expect(first.value).toEqual(record(8));
    await iterator.return?.();
  });

  test("reconnects after the last record handled when the stream ends", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const client = createHostClient({
      url: "http://host.test",
      token: "t",
      fetch: fakeFetch(
        () => ndjson([record(1), record(2)]),
        (init) => open([record(3)], init.signal),
      ),
    });

    const got: number[] = [];
    const reading = (async () => {
      for await (const r of client.replies({
        after: 0,
        signal: abort.signal,
      })) {
        got.push(r.cursor);
        if (r.cursor === 3) {
          abort.abort();
        }
      }
    })();
    await vi.advanceTimersByTimeAsync(500);
    await reading;

    expect(got).toEqual([1, 2, 3]);
    expect(urls).toEqual([
      "http://host.test/replies?after=0",
      "http://host.test/replies?after=2",
    ]);
  });

  test("waits 500 ms, then doubles up to 30 s, and starts over after a record", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const failing = () => Promise.reject(new Error("down"));
    const client = createHostClient({
      url: "http://host.test",
      token: "t",
      fetch: fakeFetch(
        failing,
        failing,
        failing,
        () => ndjson([record(1)]),
        failing,
      ),
    });

    const reading = (async () => {
      for await (const r of client.replies({
        after: 0,
        signal: abort.signal,
      })) {
        void r;
      }
    })();
    const attemptsAfter = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      return urls.length;
    };

    expect(await attemptsAfter(0)).toBe(1);
    expect(await attemptsAfter(499)).toBe(1);
    expect(await attemptsAfter(1)).toBe(2);
    expect(await attemptsAfter(999)).toBe(2);
    expect(await attemptsAfter(1)).toBe(3);
    expect(await attemptsAfter(1999)).toBe(3);
    expect(await attemptsAfter(1)).toBe(4);
    // A record arrived, so the next wait is 500 ms again.
    expect(await attemptsAfter(499)).toBe(4);
    expect(await attemptsAfter(1)).toBe(5);
    abort.abort();
    await reading;
  });

  test("throws on 401 and on 400 without retrying", async () => {
    const answer = (status: number, error: string) =>
      createHostClient({
        url: "http://host.test",
        token: "t",
        fetch: fakeFetch(() => Response.json({ error }, { status })),
      });

    const unauthorized = (async () => {
      for await (const r of answer(401, "unauthorized").replies({
        after: 0,
      })) {
        void r;
      }
    })();
    await expect(unauthorized).rejects.toThrow(
      "The host answered 401: unauthorized",
    );
    urls.length = 0;
    const bad = (async () => {
      for await (const r of answer(400, "bad prefix").replies({
        after: 0,
      })) {
        void r;
      }
    })();

    await expect(bad).rejects.toBeInstanceOf(HostRequestError);
    expect(urls).toHaveLength(1);
  });

  test("ends without an error when the signal aborts while the stream is open", async () => {
    const abort = new AbortController();
    const client = createHostClient({
      url: "http://host.test",
      token: "t",
      fetch: fakeFetch((init) => open([record(1)], init.signal)),
    });

    const got: number[] = [];
    for await (const r of client.replies({
      after: 0,
      signal: abort.signal,
    })) {
      got.push(r.cursor);
      abort.abort();
    }

    expect(got).toEqual([1]);
    expect(urls).toHaveLength(1);
  });
});

describe("send", () => {
  test("posts the text and due time, and answers with the id", async () => {
    let seen: RequestInit = {};
    const client = createHostClient({
      url: "http://host.test",
      token: "t",
      fetch: fakeFetch((init) => {
        seen = init;
        return Response.json(
          { id: "abc", dueAt: 6000 },
          { status: 202 },
        );
      }),
    });

    const sent = await client.send("discord:a", "hi", { dueAt: 6000 });

    expect(sent).toEqual({ id: "abc", dueAt: 6000 });
    expect(urls[0]).toBe(
      "http://host.test/conversations/discord%3Aa/inputs",
    );
    expect(seen.method).toBe("POST");
    expect(seen.body).toBe('{"text":"hi","dueAt":6000}');
  });

  test("throws with the status and the error text of the host", async () => {
    const client = createHostClient({
      url: "http://host.test",
      token: "t",
      fetch: fakeFetch(() =>
        Response.json(
          { error: '"text" must be a string.' },
          { status: 400 },
        ),
      ),
    });

    await expect(client.send("a", "hi")).rejects.toMatchObject({
      status: 400,
      message: 'The host answered 400: "text" must be a string.',
    });
  });
});
