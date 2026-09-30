import { describe, expect, test } from "vitest";
import {
  ProviderHttpError,
  ProviderRetryExhaustedError,
} from "./errors.js";
import { createOllamaProvider } from "./ollama/index.js";
import { createOpenRouterProvider } from "./openrouter/index.js";
import { createRetryingProvider } from "./retry.js";
import type {
  GenerateRequest,
  GenerateResponse,
  Provider,
  StreamEvent,
  ToolForcingProvider,
} from "./types.js";

type Answer =
  | { reply: GenerateResponse }
  | { events: StreamEvent[] }
  | { error: unknown }
  | { eventsThenError: StreamEvent[]; error: unknown };

type FakeProvider = Provider & { requests: GenerateRequest[] };

const fakeProvider = (
  answers: Answer[],
  extra: { name?: string; toolForcing?: boolean } = {},
): FakeProvider => {
  const requests: GenerateRequest[] = [];
  const next = (request: GenerateRequest): Answer => {
    requests.push(request);
    const answer = answers[requests.length - 1];
    if (!answer) throw new Error("fake ran out of answers");
    return answer;
  };

  return {
    ...(extra.name === undefined ? {} : { name: extra.name }),
    toolForcing: extra.toolForcing ?? true,
    requests,
    generate: async (request) => {
      const answer = next(request);
      if ("reply" in answer) return answer.reply;
      if ("error" in answer) throw answer.error;
      throw new Error("not a reply");
    },
    stream: async function* (request) {
      const answer = next(request);
      if ("events" in answer) yield* answer.events;
      if ("eventsThenError" in answer) yield* answer.eventsThenError;
      if ("error" in answer) throw answer.error;
    },
  };
};

const retryable = (ms?: number) =>
  new ProviderHttpError("busy", 503, "", {
    retryable: true,
    retryAfterMs: ms,
  });

const ok: GenerateResponse = {
  parts: [{ type: "text", text: "hi" }],
  finishReason: "stop",
};
const hi: StreamEvent = { type: "text-delta", delta: "hi" };
const stop: StreamEvent = { type: "finish", finishReason: "stop" };
const request: GenerateRequest = { model: "m", messages: [] };
const halted: GenerateResponse = { parts: [], finishReason: "halted" };

const schedule = {
  maxAttempts: 3,
  delaysMs: [1000, 2000],
  maxDelayMs: 10000,
};

const recordingSleep = () => {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
};

const collect = async (
  events: AsyncIterable<StreamEvent>,
): Promise<StreamEvent[]> => {
  const out: StreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
};

const caught = async (
  run: () => Promise<unknown>,
): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("did not throw");
};

describe("createRetryingProvider", () => {
  test("keeps name and tool forcing and passes replies and events through", async () => {
    const { sleep } = recordingSleep();
    const inner = fakeProvider(
      [{ reply: ok }, { events: [hi, stop] }],
      {
        name: "fake",
        toolForcing: true,
      },
    );
    const provider = createRetryingProvider({
      provider: inner,
      ...schedule,
      sleep,
    });

    expect(provider.name).toBe("fake");
    expect(provider.toolForcing).toBe(true);
    expect(await provider.generate(request)).toEqual(ok);
    expect(inner.requests[0]).toBe(request);
    expect(await collect(provider.stream(request))).toEqual([hi, stop]);

    const plain = createRetryingProvider({
      provider: fakeProvider([], { toolForcing: false }),
      ...schedule,
    });
    expect(plain.toolForcing).toBe(false);
    expect(plain.name).toBeUndefined();
  });

  test("throws a failure that cannot be retried after one attempt", async () => {
    const failures = [
      new ProviderHttpError("bad", 400, ""),
      new RangeError("x"),
      new DOMException("aborted", "AbortError"),
    ];

    for (const failure of failures) {
      const { waits, sleep } = recordingSleep();
      const inner = fakeProvider([{ error: failure }]);
      const provider = createRetryingProvider({
        provider: inner,
        ...schedule,
        sleep,
      });

      expect(await caught(() => provider.generate(request))).toBe(
        failure,
      );
      expect(inner.requests).toHaveLength(1);
      expect(waits).toEqual([]);
    }

    for (const failure of failures.slice(0, 2)) {
      const { waits, sleep } = recordingSleep();
      const inner = fakeProvider([{ error: failure }]);
      const provider = createRetryingProvider({
        provider: inner,
        ...schedule,
        sleep,
      });

      expect(
        await caught(() => collect(provider.stream(request))),
      ).toBe(failure);
      expect(inner.requests).toHaveLength(1);
      expect(waits).toEqual([]);
    }
  });

  test("waits the schedule in order when the failure has no wait time", async () => {
    const { waits, sleep } = recordingSleep();
    const inner = fakeProvider([
      { error: retryable() },
      { error: retryable() },
      { reply: ok },
    ]);
    const provider = createRetryingProvider({
      provider: inner,
      ...schedule,
      sleep,
    });

    expect(await provider.generate(request)).toEqual(ok);
    expect(inner.requests).toHaveLength(3);
    expect(waits).toEqual([1000, 2000]);
  });

  test("waits the error's wait time instead, up to and including the bound", async () => {
    for (const ms of [5000, 10000, 0]) {
      const { waits, sleep } = recordingSleep();
      const inner = fakeProvider([
        { error: retryable(ms) },
        { reply: ok },
      ]);
      const provider = createRetryingProvider({
        provider: inner,
        ...schedule,
        sleep,
      });

      expect(await provider.generate(request)).toEqual(ok);
      expect(waits).toEqual([ms]);
    }

    const { waits, sleep } = recordingSleep();
    const inner = fakeProvider([
      { error: retryable(5000) },
      { error: retryable() },
      { reply: ok },
    ]);
    const provider = createRetryingProvider({
      provider: inner,
      ...schedule,
      sleep,
    });

    expect(await provider.generate(request)).toEqual(ok);
    expect(waits).toEqual([5000, 2000]);
  });

  test("throws the retries-ran-out error without waiting when the wait time is over the bound", async () => {
    const { waits, sleep } = recordingSleep();
    const second = retryable(60000);
    const inner = fakeProvider([
      { error: retryable() },
      { error: second },
    ]);
    const provider = createRetryingProvider({
      provider: inner,
      ...schedule,
      sleep,
    });

    const error = await caught(() => provider.generate(request));

    expect(error).toBeInstanceOf(ProviderRetryExhaustedError);
    expect((error as ProviderRetryExhaustedError).attempts).toBe(2);
    expect((error as ProviderRetryExhaustedError).cause).toBe(second);
    expect(waits).toEqual([1000]);
  });

  test("throws the retries-ran-out error with the last failure when every attempt fails", async () => {
    const { waits, sleep } = recordingSleep();
    const third = retryable();
    const inner = fakeProvider([
      { error: retryable() },
      { error: retryable() },
      { error: third },
    ]);
    const provider = createRetryingProvider({
      provider: inner,
      ...schedule,
      sleep,
    });

    const error = (await caught(() =>
      provider.generate(request),
    )) as ProviderRetryExhaustedError;

    expect(error).toBeInstanceOf(ProviderRetryExhaustedError);
    expect(error.attempts).toBe(3);
    expect(error.cause).toBe(third);
    expect(error.retryable).toBe(false);
    expect(waits).toEqual([1000, 2000]);

    const once = createRetryingProvider({
      provider: fakeProvider([{ error: retryable() }]),
      maxAttempts: 1,
      delaysMs: [],
      maxDelayMs: 10000,
      sleep,
    });
    const onceError = (await caught(() =>
      once.generate(request),
    )) as ProviderRetryExhaustedError;
    expect(onceError.attempts).toBe(1);
    expect(waits).toEqual([1000, 2000]);
  });

  test("tries a stream again when it fails before any event", async () => {
    const { waits, sleep } = recordingSleep();
    const inner = fakeProvider([
      { error: retryable() },
      { events: [hi, stop] },
    ]);
    const provider = createRetryingProvider({
      provider: inner,
      ...schedule,
      sleep,
    });

    expect(await collect(provider.stream(request))).toEqual([hi, stop]);
    expect(waits).toEqual([1000]);

    const failing = fakeProvider([
      { error: retryable() },
      { error: retryable() },
      { error: retryable() },
    ]);
    const exhausted = createRetryingProvider({
      provider: failing,
      ...schedule,
      sleep,
    });
    const error = await caught(() =>
      collect(exhausted.stream(request)),
    );
    expect(error).toBeInstanceOf(ProviderRetryExhaustedError);
    expect((error as ProviderRetryExhaustedError).attempts).toBe(3);
  });

  test("throws a stream failure after an event unchanged with no further attempt", async () => {
    const { waits, sleep } = recordingSleep();
    const failure = retryable();
    const inner = fakeProvider([
      { eventsThenError: [hi], error: failure },
    ]);
    const provider = createRetryingProvider({
      provider: inner,
      ...schedule,
      sleep,
    });
    const seen: StreamEvent[] = [];

    const error = await caught(async () => {
      for await (const event of provider.stream(request)) {
        seen.push(event);
      }
    });

    expect(seen).toEqual([hi]);
    expect(error).toBe(failure);
    expect(inner.requests).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  test("answers halted when the halt fires during a wait", async () => {
    const controller = new AbortController();
    const inner = fakeProvider([{ error: retryable() }]);
    const provider = createRetryingProvider({
      provider: inner,
      ...schedule,
      sleep: async () => {
        controller.abort();
      },
    });

    expect(
      await provider.generate({ ...request, halt: controller.signal }),
    ).toEqual(halted);
    expect(inner.requests).toHaveLength(1);

    const second = new AbortController();
    const streamInner = fakeProvider([{ error: retryable() }]);
    const streaming = createRetryingProvider({
      provider: streamInner,
      ...schedule,
      sleep: async () => {
        second.abort();
      },
    });

    expect(
      await collect(
        streaming.stream({ ...request, halt: second.signal }),
      ),
    ).toEqual([{ type: "finish", finishReason: "halted" }]);
    expect(streamInner.requests).toHaveLength(1);
  });

  test("answers halted when the wait rejects with the halt's reason", async () => {
    const controller = new AbortController();
    const provider = createRetryingProvider({
      provider: fakeProvider([{ error: retryable() }]),
      ...schedule,
      sleep: async () => {
        controller.abort();
        throw controller.signal.reason;
      },
    });

    expect(
      await provider.generate({ ...request, halt: controller.signal }),
    ).toEqual(halted);
  });

  test("throws a wait that rejects for another reason unchanged", async () => {
    const broken = new Error("clock broke");
    const inner = fakeProvider([{ error: retryable() }]);
    const provider = createRetryingProvider({
      provider: inner,
      ...schedule,
      sleep: async () => {
        throw broken;
      },
    });

    expect(
      await caught(() =>
        provider.generate({
          ...request,
          halt: new AbortController().signal,
        }),
      ),
    ).toBe(broken);
    expect(inner.requests).toHaveLength(1);
  });

  test("waits real time by default and stops at once on halt", async () => {
    const controller = new AbortController();
    const provider = createRetryingProvider({
      provider: fakeProvider([{ error: retryable() }]),
      maxAttempts: 3,
      delaysMs: [60000, 60000],
      maxDelayMs: 100000,
    });
    setTimeout(() => controller.abort(), 10);
    const started = Date.now();

    expect(
      await provider.generate({ ...request, halt: controller.signal }),
    ).toEqual(halted);
    expect(Date.now() - started).toBeLessThan(1000);

    const quick = createRetryingProvider({
      provider: fakeProvider([{ error: retryable() }, { reply: ok }]),
      maxAttempts: 3,
      delaysMs: [20, 20],
      maxDelayMs: 100,
    });
    expect(await quick.generate(request)).toEqual(ok);
  });

  test("refuses a wrong schedule at creation", () => {
    const provider = fakeProvider([]);
    const create = (wrong: {
      maxAttempts: number;
      delaysMs: number[];
      maxDelayMs: number;
    }) => {
      return () => createRetryingProvider({ provider, ...wrong });
    };

    expect(
      create({ maxAttempts: 0, delaysMs: [], maxDelayMs: 1 }),
    ).toThrow(
      new RangeError("maxAttempts must be an integer >= 1; got 0"),
    );
    expect(
      create({ maxAttempts: 3, delaysMs: [1000], maxDelayMs: 1 }),
    ).toThrow(
      new RangeError(
        "delaysMs must have at least 2 entries for maxAttempts 3; got 1",
      ),
    );
    expect(
      create({ maxAttempts: 2, delaysMs: [-1], maxDelayMs: 1 }),
    ).toThrow(
      new RangeError(
        "delaysMs entries must be finite and >= 0; got -1",
      ),
    );
    expect(
      create({ maxAttempts: 2, delaysMs: [1], maxDelayMs: Infinity }),
    ).toThrow(
      new RangeError(
        "maxDelayMs must be finite and >= 0; got Infinity",
      ),
    );
    expect(
      create({
        maxAttempts: 3,
        delaysMs: [1000, 2000, 4000],
        maxDelayMs: 10000,
      }),
    ).not.toThrow();
  });

  test("is a ToolForcingProvider only when the wrapped provider is", () => {
    const forcing: ToolForcingProvider = createRetryingProvider({
      provider: createOpenRouterProvider({ apiKey: "k" }),
      ...schedule,
    });
    // @ts-expect-error ollama cannot force a tool call
    const notForcing: ToolForcingProvider = createRetryingProvider({
      provider: createOllamaProvider(),
      ...schedule,
    });

    expect(forcing.toolForcing).toBe(true);
    expect(notForcing.toolForcing).toBe(false);
  });
});
