import type {
  GenerateRequest,
  GenerateResponse,
  Message,
  Provider,
  UserMessage,
} from "@mg/core";
import type { HarnessEvent } from "@mg/harness";
import type {
  Trigger,
  TriggerContext,
  TriggerDecision,
} from "@mg/trigger";
import type {
  ReadableSpan,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, expectTypeOf, test } from "vitest";
import type { RunConfig } from "./config.js";
import type {
  RunOnTriggerConfig,
  RunOnTriggerOutcome,
  StartOptions,
} from "./run-on-trigger.js";
import { runOnTrigger } from "./run-on-trigger.js";
import type { RunOutcome } from "./run.js";
import { run } from "./run.js";

type TweetInput = { kind: string; text: string };

const INPUT: TweetInput = { kind: "tweet", text: "hello" };

const toMessages = (input: TweetInput): Message[] => [
  { role: "user", content: input.text },
];

const runConfig = (
  provider: Provider,
  exporters?: SpanExporter[],
): RunConfig => ({
  name: "example",
  provider,
  harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
  ...(exporters !== undefined ? { trace: { exporters } } : {}),
});

const startRun =
  (config: RunConfig) =>
  (messages: Message[], options: StartOptions): Promise<RunOutcome> =>
    run(config, messages, options);

const fakeProvider = (): {
  provider: Provider;
  calls: GenerateRequest[];
} => {
  const calls: GenerateRequest[] = [];
  const response: GenerateResponse = {
    parts: [{ type: "text", text: "ok" }],
    finishReason: "stop",
  };
  const provider: Provider = {
    generate: async (request) => {
      // The harness appends turns to this same messages array after the
      // call returns, so snapshot it now rather than keep the reference.
      calls.push({ ...request, messages: [...request.messages] });
      return response;
    },
    stream: () => {
      throw new Error("fakeProvider: stream is not scripted");
    },
  };
  return { provider, calls };
};

const throwingProvider = (error: Error): Provider => ({
  generate: async () => {
    throw error;
  },
  stream: () => {
    throw new Error("throwingProvider: stream is not scripted");
  },
});

type FakeTriggerCall = {
  input: TweetInput;
  context: TriggerContext | undefined;
};

const fakeTrigger = (
  decide: (
    input: TweetInput,
    context?: TriggerContext,
  ) => Promise<TriggerDecision>,
): { trigger: Trigger<TweetInput>; calls: FakeTriggerCall[] } => {
  const calls: FakeTriggerCall[] = [];
  return {
    trigger: {
      decide: async (input, context) => {
        calls.push({ input, context });
        return decide(input, context);
      },
    },
    calls,
  };
};

type FakeStartCall = { messages: Message[]; options: StartOptions };

const fakeStart = <TStarted extends { sessionId: string }>(
  impl: (
    messages: Message[],
    options: StartOptions,
  ) => Promise<TStarted>,
): {
  start: (
    messages: Message[],
    options: StartOptions,
  ) => Promise<TStarted>;
  calls: FakeStartCall[];
} => {
  const calls: FakeStartCall[] = [];
  return {
    start: async (messages, options) => {
      calls.push({ messages, options });
      return impl(messages, options);
    },
    calls,
  };
};

type ExportResultCallback = Parameters<SpanExporter["export"]>[1];

class FlushFailingExporter implements SpanExporter {
  constructor(private readonly error: Error) {}

  export(
    _spans: ReadableSpan[],
    resultCallback: ExportResultCallback,
  ): void {
    resultCallback({ code: 0 });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.reject(this.error);
  }
}

describe("runOnTrigger", () => {
  test("when the trigger does not fire, returns the unfired outcome and records the input without a run reference", async () => {
    const judgeExporter = new InMemorySpanExporter();
    const runExporter = new InMemorySpanExporter();
    const { trigger } = fakeTrigger(async () => ({
      fired: false,
      reason: "no",
    }));
    const { provider, calls } = fakeProvider();

    const outcome = await runOnTrigger(
      {
        trigger,
        start: startRun(runConfig(provider, [runExporter])),
        toMessages,
        trace: { exporters: [judgeExporter] },
      },
      INPUT,
    );

    expect(outcome.fired).toBe(false);
    expect(outcome.decision).toEqual({ fired: false, reason: "no" });
    expect(outcome).not.toHaveProperty("run");

    const inputSpan = judgeExporter
      .getFinishedSpans()
      .find((span) => span.name === "mg.input");
    expect(inputSpan).toBeDefined();
    expect(inputSpan?.attributes["mg.op"]).toBe("input");
    expect(inputSpan?.attributes["mg.input.value"]).toBe(
      JSON.stringify(INPUT),
    );
    expect(inputSpan?.attributes["mg.run.session"]).toBeUndefined();
    expect(inputSpan?.resource.attributes["session.id"]).toBe(
      outcome.sessionId,
    );

    expect(calls).toHaveLength(0);
    expect(runExporter.getFinishedSpans()).toHaveLength(0);
  });

  test("passes the input, the caller's signal, and the input span as the trigger's context", async () => {
    const judgeExporter = new InMemorySpanExporter();
    const controller = new AbortController();
    let seenInput: TweetInput | undefined;
    let seenSignal: AbortSignal | undefined;
    const trigger: Trigger<TweetInput> = {
      decide: async (input, context) => {
        seenInput = input;
        seenSignal = context?.signal;
        const probe = context?.trace?.startSpan("probe");
        probe?.end();
        return { fired: false, reason: "no" };
      },
    };
    const { provider } = fakeProvider();

    await runOnTrigger(
      {
        trigger,
        start: startRun(runConfig(provider)),
        toMessages,
        trace: { exporters: [judgeExporter] },
      },
      INPUT,
      { signal: controller.signal },
    );

    expect(seenInput).toEqual(INPUT);
    expect(seenSignal).toBe(controller.signal);

    const spans = judgeExporter.getFinishedSpans();
    const inputSpan = spans.find((span) => span.name === "mg.input");
    const probeSpan = spans.find((span) => span.name === "probe");
    expect(probeSpan?.parentSpanContext?.spanId).toBe(
      inputSpan?.spanContext().spanId,
    );
  });

  test("when the trigger fires, starts the run with the converted messages and returns its outcome", async () => {
    const judgeExporter = new InMemorySpanExporter();
    const runExporter = new InMemorySpanExporter();
    const { trigger } = fakeTrigger(async () => ({
      fired: true,
      reason: "yes",
    }));
    const { provider, calls } = fakeProvider();

    const outcome = await runOnTrigger(
      {
        trigger,
        start: startRun(runConfig(provider, [runExporter])),
        toMessages,
        trace: { exporters: [judgeExporter] },
      },
      INPUT,
    );

    expect(outcome.fired).toBe(true);
    expect(outcome.decision).toEqual({ fired: true, reason: "yes" });
    if (!outcome.fired) throw new Error("expected a fired outcome");
    expect(outcome.run.result.reason).toBe("stop");
    expect(calls[0]?.messages).toEqual([
      { role: "user", content: "hello" },
    ]);

    const inputSpan = judgeExporter
      .getFinishedSpans()
      .find((span) => span.name === "mg.input");
    expect(inputSpan?.attributes["mg.run.session"]).toBe(
      outcome.run.sessionId,
    );
    expect(outcome.run.sessionId).not.toBe(outcome.sessionId);

    const runRootSpan = runExporter
      .getFinishedSpans()
      .find((span) => span.name === "mg.run");
    expect(runRootSpan?.resource.attributes["session.id"]).toBe(
      outcome.run.sessionId,
    );
  });

  test("closes and flushes the judgement record before the run's provider is called", async () => {
    const judgeExporter = new InMemorySpanExporter();
    const { trigger } = fakeTrigger(async () => ({
      fired: true,
      reason: "yes",
    }));
    let observed:
      { ended: boolean; hasRunSession: boolean } | undefined;
    const provider: Provider = {
      generate: async () => {
        const inputSpan = judgeExporter
          .getFinishedSpans()
          .find((span) => span.name === "mg.input");
        observed = {
          ended: inputSpan !== undefined,
          hasRunSession:
            inputSpan?.attributes["mg.run.session"] !== undefined,
        };
        return {
          parts: [{ type: "text", text: "ok" }],
          finishReason: "stop",
        };
      },
      stream: () => {
        throw new Error("provider: stream is not scripted");
      },
    };

    await runOnTrigger(
      {
        trigger,
        start: startRun(runConfig(provider)),
        toMessages,
        trace: { exporters: [judgeExporter] },
      },
      INPUT,
    );

    expect(observed).toEqual({ ended: true, hasRunSession: true });
  });

  test("a trigger that throws rejects with the same error, ends mg.input as an error, and never calls the provider", async () => {
    const judgeExporter = new InMemorySpanExporter();
    const error = new Error("judge broke");
    const { trigger } = fakeTrigger(async () => {
      throw error;
    });
    const { provider, calls } = fakeProvider();

    await expect(
      runOnTrigger(
        {
          trigger,
          start: startRun(runConfig(provider)),
          toMessages,
          trace: { exporters: [judgeExporter] },
        },
        INPUT,
      ),
    ).rejects.toThrow(error);

    const inputSpan = judgeExporter
      .getFinishedSpans()
      .find((span) => span.name === "mg.input");
    expect(inputSpan?.status.code).toBe(2);
    expect(calls).toHaveLength(0);
  });

  test("a converter that throws rejects with the same error, ends mg.input as an error without a run reference, and never calls the provider", async () => {
    const judgeExporter = new InMemorySpanExporter();
    const error = new Error("convert broke");
    const { trigger } = fakeTrigger(async () => ({
      fired: true,
      reason: "yes",
    }));
    const { provider, calls } = fakeProvider();
    const throwingToMessages = (): Message[] => {
      throw error;
    };

    await expect(
      runOnTrigger(
        {
          trigger,
          start: startRun(runConfig(provider)),
          toMessages: throwingToMessages,
          trace: { exporters: [judgeExporter] },
        },
        INPUT,
      ),
    ).rejects.toThrow(error);

    const inputSpan = judgeExporter
      .getFinishedSpans()
      .find((span) => span.name === "mg.input");
    expect(inputSpan?.status.code).toBe(2);
    expect(inputSpan?.attributes["mg.run.session"]).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("an unopenable judgement trace destination rejects before the trigger or the provider run", async () => {
    const { trigger, calls: triggerCalls } = fakeTrigger(async () => ({
      fired: false,
      reason: "no",
    }));
    const { provider, calls } = fakeProvider();

    await expect(
      runOnTrigger(
        {
          trigger,
          start: startRun(runConfig(provider)),
          toMessages,
          trace: { sqlitePath: ":memory:" },
        },
        INPUT,
      ),
    ).rejects.toThrow(RangeError);

    expect(triggerCalls).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  test("a judgement record flush failure rejects with the array the trace SDK throws, and never calls the provider", async () => {
    const flushError = new Error("flush broke");
    const { trigger } = fakeTrigger(async () => ({
      fired: true,
      reason: "yes",
    }));
    const { provider, calls } = fakeProvider();

    let caught: unknown;
    try {
      await runOnTrigger(
        {
          trigger,
          start: startRun(runConfig(provider)),
          toMessages,
          trace: { exporters: [new FlushFailingExporter(flushError)] },
        },
        INPUT,
      );
    } catch (error) {
      caught = error;
    }

    expect(Array.isArray(caught)).toBe(true);
    expect(caught).toHaveLength(1);
    expect((caught as unknown[])[0]).toBe(flushError);
    expect(calls).toHaveLength(0);
  });

  test("when the trigger throws and the flush also fails, the trigger's error is what's thrown", async () => {
    const flushError = new Error("flush broke");
    const judgeError = new Error("judge broke");
    const { trigger } = fakeTrigger(async () => {
      throw judgeError;
    });
    const { provider, calls } = fakeProvider();

    await expect(
      runOnTrigger(
        {
          trigger,
          start: startRun(runConfig(provider)),
          toMessages,
          trace: { exporters: [new FlushFailingExporter(flushError)] },
        },
        INPUT,
      ),
    ).rejects.toThrow(judgeError);

    expect(calls).toHaveLength(0);
  });

  test("when the trigger fires and the run fails, rejects with the run's error, leaving mg.input closed with the run's session reference", async () => {
    const judgeExporter = new InMemorySpanExporter();
    const { trigger } = fakeTrigger(async () => ({
      fired: true,
      reason: "yes",
    }));
    const error = new Error("provider broke");
    const provider = throwingProvider(error);

    await expect(
      runOnTrigger(
        {
          trigger,
          start: startRun(runConfig(provider)),
          toMessages,
          trace: { exporters: [judgeExporter] },
        },
        INPUT,
      ),
    ).rejects.toThrow(error);

    const inputSpan = judgeExporter
      .getFinishedSpans()
      .find((span) => span.name === "mg.input");
    expect(inputSpan?.status.code).not.toBe(2);
    expect(inputSpan?.attributes["mg.run.session"]).toBeDefined();
  });

  test("onEvent receives the run's events, ending with done", async () => {
    const { trigger } = fakeTrigger(async () => ({
      fired: true,
      reason: "yes",
    }));
    const { provider } = fakeProvider();
    const seen: HarnessEvent["type"][] = [];

    await runOnTrigger(
      {
        trigger,
        start: startRun(runConfig(provider)),
        toMessages,
        trace: { exporters: [new InMemorySpanExporter()] },
      },
      INPUT,
      { onEvent: (event) => seen.push(event.type) },
    );

    expect(seen.at(-1)).toBe("done");
  });

  test("aborting the signal inside the converter stops the run before the provider is called", async () => {
    const controller = new AbortController();
    const { trigger } = fakeTrigger(async () => ({
      fired: true,
      reason: "yes",
    }));
    const { provider, calls } = fakeProvider();
    const abortingToMessages = (input: TweetInput): Message[] => {
      controller.abort(new Error("stop"));
      return toMessages(input);
    };

    await expect(
      runOnTrigger(
        {
          trigger,
          start: startRun(runConfig(provider)),
          toMessages: abortingToMessages,
          trace: { exporters: [new InMemorySpanExporter()] },
        },
        INPUT,
        { signal: controller.signal },
      ),
    ).rejects.toThrow("stop");

    expect(calls).toHaveLength(0);
  });

  test("passes the converted messages and the decided session id, signal, and event callback to the start function", async () => {
    const judgeExporter = new InMemorySpanExporter();
    const { trigger } = fakeTrigger(async () => ({
      fired: true,
      reason: "yes",
    }));
    const controller = new AbortController();
    const onEvent = (): void => {};
    const { start, calls } = fakeStart(async (_messages, options) => ({
      sessionId: options.sessionId,
      tag: "mine",
    }));

    await runOnTrigger(
      {
        trigger,
        toMessages,
        start,
        trace: { exporters: [judgeExporter] },
      },
      INPUT,
      { signal: controller.signal, onEvent },
    );

    const inputSpan = judgeExporter
      .getFinishedSpans()
      .find((span) => span.name === "mg.input");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.messages).toEqual([
      { role: "user", content: "hello" },
    ]);
    expect(calls[0]?.options.signal).toBe(controller.signal);
    expect(calls[0]?.options.onEvent).toBe(onEvent);
    expect(calls[0]?.options.sessionId).toBe(
      inputSpan?.attributes["mg.run.session"],
    );
  });

  test("when the start function returns the session id it was given, the outcome carries it as a referenced run", async () => {
    const { trigger } = fakeTrigger(async () => ({
      fired: true,
      reason: "yes",
    }));
    const { start } = fakeStart(async (_messages, options) => ({
      sessionId: options.sessionId,
      tag: "mine",
    }));

    const outcome = await runOnTrigger(
      {
        trigger,
        toMessages,
        start,
        trace: { exporters: [new InMemorySpanExporter()] },
      },
      INPUT,
    );

    expect(outcome.fired).toBe(true);
    if (!outcome.fired) throw new Error("expected a fired outcome");
    expect(outcome.referenced).toBe(true);
    expect(outcome.decision).toEqual({ fired: true, reason: "yes" });
    if (!outcome.referenced) {
      throw new Error("expected a referenced outcome");
    }
    const started = await start([{ role: "user", content: "hello" }], {
      sessionId: "probe",
    });
    expect(outcome.run).not.toBe(started);
    expect(outcome.run).toEqual({ sessionId: "probe", tag: "mine" });
    expect((outcome.run as { tag: string }).tag).toBe("mine");
  });

  test("when the start function returns a different session id, the outcome reports the reference is lost without rejecting", async () => {
    const judgeExporter = new InMemorySpanExporter();
    const { trigger } = fakeTrigger(async () => ({
      fired: true,
      reason: "yes",
    }));
    const { start } = fakeStart(async () => ({ sessionId: "other" }));

    const outcome = await runOnTrigger(
      {
        trigger,
        toMessages,
        start,
        trace: { exporters: [judgeExporter] },
      },
      INPUT,
    );

    const inputSpan = judgeExporter
      .getFinishedSpans()
      .find((span) => span.name === "mg.input");

    expect(outcome.fired).toBe(true);
    if (!outcome.fired) throw new Error("expected a fired outcome");
    expect(outcome.referenced).toBe(false);
    if (outcome.referenced) {
      throw new Error("expected an unreferenced outcome");
    }
    expect(outcome.expectedRunSessionId).toBe(
      inputSpan?.attributes["mg.run.session"],
    );
    expect(outcome.run).toEqual({ sessionId: "other" });
  });

  test("a start function that throws rejects the entrance with that error, leaving mg.input closed without an error and with the run reference", async () => {
    const judgeExporter = new InMemorySpanExporter();
    const { trigger } = fakeTrigger(async () => ({
      fired: true,
      reason: "yes",
    }));
    const error = new Error("start broke");
    const { start } = fakeStart(async () => {
      throw error;
    });

    let caught: unknown;
    try {
      await runOnTrigger(
        {
          trigger,
          toMessages,
          start,
          trace: { exporters: [judgeExporter] },
        },
        INPUT,
      );
    } catch (thrown) {
      caught = thrown;
    }

    expect(caught).toBe(error);

    const inputSpan = judgeExporter
      .getFinishedSpans()
      .find((span) => span.name === "mg.input");
    expect(inputSpan?.status.code).not.toBe(2);
    expect(inputSpan?.attributes["mg.run.session"]).toBeDefined();
  });

  test("when the trigger does not fire, the start function is never called", async () => {
    const { trigger } = fakeTrigger(async () => ({
      fired: false,
      reason: "no",
    }));
    const { start, calls } = fakeStart(async (_messages, options) => ({
      sessionId: options.sessionId,
    }));

    const outcome = await runOnTrigger(
      {
        trigger,
        toMessages,
        start,
        trace: { exporters: [new InMemorySpanExporter()] },
      },
      INPUT,
    );

    expect(outcome.fired).toBe(false);
    expect(outcome).not.toHaveProperty("run");
    expect(calls).toHaveLength(0);
  });

  test("the start function is called only after the judgement record is closed and written", async () => {
    const judgeExporter = new InMemorySpanExporter();
    const { trigger } = fakeTrigger(async () => ({
      fired: true,
      reason: "yes",
    }));
    let observed:
      { ended: boolean; hasRunSession: boolean } | undefined;
    const { start } = fakeStart(async (_messages, options) => {
      const inputSpan = judgeExporter
        .getFinishedSpans()
        .find((span) => span.name === "mg.input");
      observed = {
        ended: inputSpan !== undefined,
        hasRunSession:
          inputSpan?.attributes["mg.run.session"] !== undefined,
      };
      return { sessionId: options.sessionId };
    });

    await runOnTrigger(
      {
        trigger,
        toMessages,
        start,
        trace: { exporters: [judgeExporter] },
      },
      INPUT,
    );

    expect(observed).toEqual({ ended: true, hasRunSession: true });
  });
});

describe("RunOnTriggerConfig", () => {
  test("requires the trace config to declare at least one destination, and rejects an input that is not a JSON value", () => {
    const base = {
      trigger: fakeTrigger(async () => ({ fired: false, reason: "no" }))
        .trigger,
      start: startRun(runConfig(fakeProvider().provider)),
      toMessages,
    };

    ({
      ...base,
      // @ts-expect-error a trace config needs a destination
      trace: {},
    }) satisfies RunOnTriggerConfig<TweetInput>;

    ({
      ...base,
      // @ts-expect-error a trace config needs a destination
      trace: { serviceName: "x" },
    }) satisfies RunOnTriggerConfig<TweetInput>;

    ({
      ...base,
      // @ts-expect-error exporters must not be empty
      trace: { exporters: [] },
    }) satisfies RunOnTriggerConfig<TweetInput>;

    // @ts-expect-error a Date is not a JSON value
    expectTypeOf<RunOnTriggerConfig<{ at: Date }>>();

    expect(true).toBe(true);
  });

  test("requires a start function, and rejects one that cannot receive what toMessages converts to", () => {
    const trace = { exporters: [new InMemorySpanExporter()] };
    const trigger = fakeTrigger(async () => ({
      fired: false,
      reason: "no",
    })).trigger;

    // @ts-expect-error a config without start is rejected
    ({
      trigger,
      toMessages,
      trace,
    }) satisfies RunOnTriggerConfig<TweetInput>;

    const toUserMessages = (input: TweetInput): Message[] => [
      { role: "user", content: input.text },
    ];
    const startUserMessagesOnly = async (
      _messages: UserMessage[],
      options: StartOptions,
    ): Promise<RunOutcome> => ({
      sessionId: options.sessionId,
      result: {
        reason: "stop",
        messages: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    });

    ({
      trigger,
      trace,
      toMessages: toUserMessages,
      // @ts-expect-error start cannot receive what toMessages converts to
      start: startUserMessagesOnly,
    }) satisfies RunOnTriggerConfig<TweetInput, Message>;

    expect(true).toBe(true);
  });

  test("requires narrowing on referenced before reading expectedRunSessionId", () => {
    const outcome = {} as RunOnTriggerOutcome<RunOutcome>;

    if (outcome.fired) {
      // @ts-expect-error expectedRunSessionId only exists once referenced is narrowed to false
      outcome.expectedRunSessionId;
    }

    expect(true).toBe(true);
  });
});
