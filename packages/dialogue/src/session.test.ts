import type {
  HarnessEvent,
  TraceAttributes,
  TraceSpan,
} from "@mg/harness";
import { ATTR, SPAN } from "@mg/trace";
import type { TriggerDecision } from "@mg/trigger";
import {
  JudgeError,
  type RedirectAnswer,
  type RedirectSituation,
  type ReportAnswer,
  type ReportSituation,
  type StopAnswer,
  type StopSituation,
} from "@mg/turn";
import type {
  AudioChunk,
  HeardUtterance,
  Listener,
  PlaybackEnd,
  Player,
  SpeechSynthesizer,
  TranscriptEvent,
  Transcriber,
} from "@mg/voice";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TalkerError } from "./errors.js";
import { runDialogue } from "./session.js";
import type {
  DialogueEvent,
  Talker,
  TalkerReplyOptions,
  WorkEnding,
  WorkRequestOptions,
  WorkStatus,
  WorkTriggerInput,
  Worker,
} from "./types.js";

const format = {
  encoding: "pcm-s16le",
  sampleRate: 16000,
  channels: 1,
} as const;

const settle = async () => {
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
};

const channel = <T extends object>() => {
  const items: T[] = [];
  let closed = false;
  let failure: { error: unknown } | undefined;
  let wake: (() => void) | undefined;
  const poke = () => {
    wake?.();
    wake = undefined;
  };
  return {
    push(item: T) {
      items.push(item);
      poke();
    },
    close() {
      closed = true;
      poke();
    },
    fail(error: unknown) {
      failure = { error };
      poke();
    },
    async *iterate(): AsyncGenerator<T> {
      while (true) {
        const next = items.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (failure !== undefined) throw failure.error;
        if (closed) return;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
};

const fakeListener = () => {
  const utterances = channel<HeardUtterance>();
  const listener: Listener = {
    listen(signal) {
      signal.addEventListener("abort", () => utterances.close());
      return utterances.iterate();
    },
  };
  return {
    listener,
    utter: () => utterances.push({ audio: (async function* () {})() }),
    utterOpen: () => {
      const audio = channel<AudioChunk>();
      utterances.push({ audio: audio.iterate() });
      return { end: audio.close, fail: audio.fail };
    },
    end: () => utterances.close(),
    fail: (error: unknown) => utterances.fail(error),
  };
};

type TranscriptionCall = {
  partial(text: string): void;
  final(text: string): void;
  fail(error: unknown): void;
};

const fakeTranscriber = () => {
  const calls: TranscriptionCall[] = [];
  const transcriber: Transcriber = {
    accepts: [],
    transcribe(audio, options) {
      const events = channel<TranscriptEvent>();
      options?.signal?.addEventListener("abort", () => events.close());
      void (async () => {
        try {
          for await (const chunk of audio) void chunk;
        } catch {
          // the audio failing is not what these fakes report
        }
      })();
      calls.push({
        partial: (text) => events.push({ type: "partial", text }),
        final: (text) => {
          events.push({ type: "final", text });
          events.close();
        },
        fail: (error) => events.fail(error),
      });
      return events.iterate();
    },
  };
  return { transcriber, calls };
};

const fakeSynthesizer = (failOn?: string): SpeechSynthesizer => ({
  synthesize(text) {
    return (async function* (): AsyncGenerator<AudioChunk> {
      if (text === failOn) throw new Error("quota");
      yield { format, data: new TextEncoder().encode(text) };
    })();
  },
});

type PlayerScript = (
  index: number,
  textNumber: number,
) => Promise<PlaybackEnd> | "hold";

const fakePlayer = (script?: PlayerScript) => {
  const received: { index: number; text: string }[] = [];
  const log: string[] = [];
  const held: ((end: PlaybackEnd) => void)[] = [];
  let textNumber = -1;
  let stopCalls = 0;
  const player: Player = {
    async play(index, audio) {
      let text = "";
      for await (const chunk of audio) {
        text += new TextDecoder().decode(chunk.data);
      }
      if (index === 0) textNumber += 1;
      received.push({ index, text });
      log.push(`play:${index}:${text}`);
      const result =
        script?.(index, textNumber) ??
        Promise.resolve<PlaybackEnd>({ played: true });
      if (result !== "hold") return result;
      return new Promise<PlaybackEnd>((resolve) => held.push(resolve));
    },
    stop() {
      stopCalls += 1;
      log.push("stop");
      for (const resolve of held.splice(0)) resolve({ played: false });
    },
  };
  return {
    player,
    received,
    log,
    get stopCalls() {
      return stopCalls;
    },
    texts: () =>
      received.filter((r) => r.index === 0).map((r) => r.text),
    finishHeld: (end: PlaybackEnd) => {
      for (const resolve of held.splice(0)) resolve(end);
    },
  };
};

type Scripted<A> = A | Error;

const scriptedJudge = <S, A>(
  answers: readonly Scripted<A>[],
  fallback: A,
  options: { delayMs?: number; span?: string } = {},
) => {
  const calls: S[] = [];
  const times: number[] = [];
  const judge = async (
    situation: S,
    context?: { trace?: TraceSpan },
  ): Promise<A> => {
    const n = calls.length;
    calls.push(structuredClone(situation));
    times.push(Date.now());
    if (options.span !== undefined) {
      context?.trace
        ?.startSpan(SPAN.turn, { [ATTR.turnJudge]: options.span })
        .end();
    }
    if (options.delayMs !== undefined) {
      await new Promise((resolve) =>
        setTimeout(resolve, options.delayMs),
      );
    }
    const answer = answers[n] ?? fallback;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { calls, times, judge };
};

const fakeTrigger = (answers: readonly Scripted<boolean>[]) => {
  const calls: WorkTriggerInput[] = [];
  return {
    calls,
    decide: async (
      input: WorkTriggerInput,
    ): Promise<TriggerDecision> => {
      const n = calls.length;
      calls.push(structuredClone(input));
      const answer = answers[n] ?? false;
      if (answer instanceof Error) throw answer;
      return { fired: answer, reason: "r" };
    },
  };
};

type TalkerScript = (
  message: string,
  options: TalkerReplyOptions,
  n: number,
) => Promise<{ sessionId: string }>;

const fakeTalker = () => {
  const calls: {
    message: string;
    options: TalkerReplyOptions;
  }[] = [];
  const heard: number[] = [];
  const resolved: number[] = [];
  let replies: (string | TalkerScript)[] = [];
  const speaks =
    (text: string): TalkerScript =>
    async (_message, options, n) => {
      options.onText(text);
      options.onTextEnd();
      heard.push(await options.heard);
      resolved.push(n);
      return { sessionId: `t${n}` };
    };
  const talker: Talker = {
    reply(message, options) {
      const n = calls.length;
      calls.push({ message, options });
      const script = replies[n] ?? "はい。";
      return (typeof script === "string" ? speaks(script) : script)(
        message,
        options,
        n,
      );
    },
  };
  return {
    talker,
    calls,
    heard,
    resolved,
    script: (list: (string | TalkerScript)[]) => {
      replies = list;
    },
    speaks,
  };
};

const fakeWorker = () => {
  const requests: {
    text: string;
    options: WorkRequestOptions;
    finish: (ending: WorkEnding) => void;
  }[] = [];
  const counts = { holds: 0, releases: 0, wrapUps: 0 };
  const worker: Worker = {
    request(text, options) {
      return new Promise<WorkEnding>((resolve) => {
        requests.push({ text, options, finish: resolve });
        options.onStart(`w${requests.length}`);
      });
    },
    hold: () => void (counts.holds += 1),
    release: () => void (counts.releases += 1),
    wrapUp: () => void (counts.wrapUps += 1),
  };
  return {
    worker,
    requests,
    counts,
    emit: (event: HarnessEvent) =>
      requests.at(-1)?.options.onEvent(event),
    end: (ending: WorkEnding) => requests.at(-1)?.finish(ending),
  };
};

class RecordingSpan implements TraceSpan {
  readonly name: string;
  readonly attributes: TraceAttributes;
  readonly children: RecordingSpan[] = [];
  readonly setAttributesCalls: TraceAttributes[] = [];

  constructor(name: string, attributes?: TraceAttributes) {
    this.name = name;
    this.attributes = attributes ?? {};
  }

  startSpan(name: string, attributes?: TraceAttributes): TraceSpan {
    const child = new RecordingSpan(name, attributes);
    this.children.push(child);
    return child;
  }

  startRoot(name: string, attributes?: TraceAttributes): TraceSpan {
    return this.startSpan(name, attributes);
  }

  setAttributes(attributes: TraceAttributes): void {
    this.setAttributesCalls.push(attributes);
  }

  addEvent(): void {}

  end(): void {}

  get mergedAttributes(): TraceAttributes {
    return Object.assign(
      {},
      this.attributes,
      ...this.setAttributesCalls,
    );
  }
}

const action = <A extends { action: string }>(
  list: readonly Scripted<A["action"]>[],
): Scripted<A>[] =>
  list.map((a) =>
    a instanceof Error ? a : ({ action: a } as unknown as A),
  );

type Config = {
  // The first utterance starts a request with this text.
  work?: string;
  replies?: (string | TalkerScript)[];
  stop?: Scripted<StopAnswer["action"]>[];
  stopDelayMs?: number;
  redirect?: Scripted<RedirectAnswer["action"]>[];
  report?: Scripted<ReportAnswer["action"]>[];
  trigger?: Scripted<boolean>[];
  player?: PlayerScript;
  synthesizerFailsOn?: string;
  trace?: TraceSpan;
  judgeSpans?: boolean;
};

const build = (config: Config = {}) => {
  const listener = fakeListener();
  const transcriber = fakeTranscriber();
  const player = fakePlayer(config.player);
  const talker = fakeTalker();
  talker.script(config.replies ?? []);
  const worker = fakeWorker();
  const stop = scriptedJudge<StopSituation, StopAnswer>(
    action<StopAnswer>(config.stop ?? []),
    { action: "continue" },
    {
      delayMs: config.stopDelayMs,
      span: config.judgeSpans ? "stop" : undefined,
    },
  );
  const redirect = scriptedJudge<RedirectSituation, RedirectAnswer>(
    action<RedirectAnswer>(config.redirect ?? []),
    { action: "continue" },
    { span: config.judgeSpans ? "redirect" : undefined },
  );
  const report = scriptedJudge<ReportSituation, ReportAnswer>(
    action<ReportAnswer>(config.report ?? []),
    { action: "defer" },
  );
  const trigger = fakeTrigger(
    config.work === undefined
      ? (config.trigger ?? [])
      : [true, ...(config.trigger ?? [])],
  );
  const statuses: { status: WorkStatus; utterance: string }[] = [];
  let requestCalls = 0;
  const events: DialogueEvent[] = [];
  const abort = new AbortController();
  const outcome: {
    status: "pending" | "resolved" | "rejected";
    error?: unknown;
  } = { status: "pending" };

  const describeEnding = (ending: WorkEnding) =>
    ending.kind === "ended"
      ? `res:${ending.reason}:${ending.text}`
      : `res:failed:${ending.reason}`;

  const session = runDialogue(
    {
      listener: listener.listener,
      transcriber: transcriber.transcriber,
      synthesizer: fakeSynthesizer(config.synthesizerFailsOn),
      player: player.player,
      judges: {
        stop,
        redirect,
        report,
      },
      workTrigger: trigger,
      talker: talker.talker,
      worker: worker.worker,
      wording: {
        message: (status, utterance) => {
          statuses.push({
            status: JSON.parse(JSON.stringify(status)) as WorkStatus,
            utterance,
          });
          return `M:${status.state}:${utterance}`;
        },
        report: (status) => `P:${status.state}`,
        request: (exchanges) => {
          const n = requestCalls;
          requestCalls += 1;
          if (n === 0 && config.work !== undefined) return config.work;
          return `Q:${exchanges
            .map((e) => `${e.utterance}/${e.reply}`)
            .join(",")}`;
        },
        result: describeEnding,
        notices: {
          judgment: "notice-judgment",
          transcription: "notice-transcription",
          talker: "notice-talker",
        },
      },
      stopCheckMs: 100,
      exchangeCount: 2,
      requestLimit: 10,
    },
    {
      signal: abort.signal,
      trace: config.trace,
      onEvent: (event) => events.push(event),
    },
  );
  session.then(
    () => void (outcome.status = "resolved"),
    (error: unknown) => {
      outcome.status = "rejected";
      outcome.error = error;
    },
  );
  const harness = {
    listener,
    transcriber,
    player,
    talker,
    worker,
    stop,
    redirect,
    report,
    trigger,
    statuses,
    events,
    abort,
    outcome,
  };
  cleanups.push(() => abort.abort());
  return harness;
};

type Harness = ReturnType<typeof build>;

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});

const hear = async (h: Harness) => {
  h.listener.utter();
  await settle();
  const call = h.transcriber.calls.at(-1);
  if (call === undefined) throw new Error("no transcription started");
  return call;
};

const say = async (h: Harness, text: string) => {
  const call = await hear(h);
  call.final(text);
  await settle();
};

const startWork = async (h: Harness) => {
  await say(h, "A");
};

const toolCall = (name: string, args: string): HarnessEvent => ({
  type: "tool-call",
  toolCall: { id: "c1", name, arguments: args },
});

const toolResult = (content: string): HarnessEvent => ({
  type: "tool-result",
  message: { role: "tool", toolCallId: "c1", content },
});

const describeEvent = (event: DialogueEvent): string => {
  switch (event.type) {
    case "transcript":
      return `transcript:${event.text}:${event.final}`;
    case "work":
      return `work:${event.action}`;
    case "judgment":
      return `judgment:${event.judge}:${event.answer}`;
    case "reply":
      return `reply:${event.text}`;
    default:
      return event.type;
  }
};

const stopped = (): WorkEnding => ({
  kind: "ended",
  reason: "stop",
  text: "完了",
  sessionId: "w1",
});

describe("runDialogue", () => {
  test("holds the worker at the first non-empty partial when a request runs", async () => {
    vi.useFakeTimers();
    const h = build({ work: "直して" });
    await startWork(h);
    const call = await hear(h);
    call.partial("");
    await settle();
    expect(h.worker.counts.holds).toBe(0);
    call.partial("あ");
    await settle();
    expect(h.worker.counts.holds).toBe(1);
  });

  test("holds nothing on partials when no request runs", async () => {
    vi.useFakeTimers();
    const h = build();
    const call = await hear(h);
    call.partial("");
    call.partial("あ");
    await settle();
    expect(h.worker.counts.holds).toBe(0);
  });

  test("asks the stop judge once per changed text with the running work, and follows its answers", async () => {
    vi.useFakeTimers();
    const h = build({
      work: "直して",
      stop: ["continue", "stop"],
      stopDelayMs: 10,
    });
    await startWork(h);
    const call = await hear(h);
    call.partial("ち");
    await vi.advanceTimersByTimeAsync(50);
    call.partial("ちが");
    await vi.advanceTimersByTimeAsync(300);
    expect(h.stop.calls).toEqual([
      { utterance: "ちが", work: { request: "直して", tools: [] } },
    ]);
    expect(h.worker.counts.releases).toBe(1);
    call.partial("ちがう");
    await vi.advanceTimersByTimeAsync(100);
    expect(h.stop.calls).toHaveLength(2);
    expect(h.stop.calls[1]?.utterance).toBe("ちがう");
    expect(h.worker.counts.holds).toBe(2);
  });

  test("does not ask the stop judge while an ask is in flight", async () => {
    vi.useFakeTimers();
    const h = build({ work: "直して", stopDelayMs: 250 });
    await startWork(h);
    const call = await hear(h);
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      call.partial(`あ${i}`);
      if (i < 9) await vi.advanceTimersByTimeAsync(50);
    }
    await settle();
    expect(h.stop.times.map((t) => t - start)).toEqual([100, 400]);
  });

  test("keeps the hold at the final text and gives the talker the status and the text", async () => {
    vi.useFakeTimers();
    const h = build({
      work: "直して",
      replies: ["はい。", () => new Promise(() => {})],
    });
    await startWork(h);
    const call = await hear(h);
    call.partial("あ");
    call.final("それで");
    await settle();
    expect(h.worker.counts.holds).toBe(1);
    expect(h.worker.counts.releases).toBe(0);
    expect(h.talker.calls[1]?.message).toBe("M:held:それで");
  });

  test("stops playback, wraps up the talker and hands it the heard count when a new utterance starts, and asks the next talker reply only after the cut one settled", async () => {
    vi.useFakeTimers();
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    const heard: number[] = [];
    const h = build({
      replies: [
        async (_message, options, n) => {
          options.onText("一つ目。二つ目。");
          options.onTextEnd();
          heard.push(await options.heard);
          await gate;
          return { sessionId: `t${n}` };
        },
      ],
      player: (index, text) =>
        text === 0 && index === 1
          ? "hold"
          : Promise.resolve({ played: true }),
    });
    await say(h, "こんにちは");
    expect(h.player.received.map((r) => r.index)).toEqual([0, 1]);
    h.listener.utter();
    await settle();
    expect(h.player.stopCalls).toBe(1);
    expect(h.talker.calls[0]?.options.wrapUp.aborted).toBe(true);
    expect(heard).toEqual([4]);
    h.transcriber.calls.at(-1)?.final("もう一度");
    await settle();
    expect(h.talker.calls).toHaveLength(1);
    open();
    await settle();
    expect(h.talker.calls).toHaveLength(2);
    expect(h.redirect.calls).toHaveLength(0);
    expect(h.trigger.calls).toHaveLength(1);
  });

  test("hands a reply that finished playing to the work trigger in full when a new utterance starts right after its playback ends", async () => {
    vi.useFakeTimers();
    const h = build({
      replies: ["はい。"],
      player: () => "hold",
    });
    await say(h, "こんにちは");
    h.player.finishHeld({ played: true });
    h.listener.utter();
    await settle();
    expect(
      h.events.filter((e) => e.type === "reply").map(describeEvent),
    ).toEqual(["reply:はい。"]);
    expect(h.trigger.calls).toEqual([
      { exchanges: [{ utterance: "こんにちは", reply: "はい。" }] },
    ]);
  });

  test("shows only the heard part of a reply cut while playing, and does not ask the work trigger", async () => {
    vi.useFakeTimers();
    const h = build({
      replies: ["一つ目。二つ目。"],
      player: (index) =>
        index === 1 ? "hold" : Promise.resolve({ played: true }),
    });
    await say(h, "こんにちは");
    h.listener.utter();
    await settle();
    expect(
      h.events.filter((e) => e.type === "reply").map(describeEvent),
    ).toEqual(["reply:一つ目。"]);
    expect(h.trigger.calls).toHaveLength(0);
  });

  test("gives the redirect judge the last exchanges and the request, then wraps up and sends a new request on switch", async () => {
    vi.useFakeTimers();
    const h = build({
      work: "直して",
      replies: ["a", "b", "c"],
      redirect: ["continue", "switch"],
    });
    await say(h, "A");
    await say(h, "B");
    const releasesBefore = h.worker.counts.releases;
    await say(h, "C");
    expect(h.redirect.calls[1]).toEqual({
      exchanges: [
        { utterance: "B", reply: "b" },
        { utterance: "C", reply: "c" },
      ],
      request: "直して",
    });
    expect(h.worker.counts.releases - releasesBefore).toBe(1);
    expect(h.worker.counts.wrapUps).toBe(1);
    expect(h.worker.requests).toHaveLength(1);
    h.worker.end({
      kind: "ended",
      reason: "wrapped-up",
      text: "",
      sessionId: "w1",
    });
    await settle();
    expect(h.worker.requests.map((r) => r.text)).toEqual([
      "直して",
      "Q:B/b,C/c",
    ]);
  });

  test("releases the worker and sends no request on continue", async () => {
    vi.useFakeTimers();
    const h = build({
      work: "直して",
      replies: ["a", "b"],
      redirect: ["continue"],
    });
    await say(h, "A");
    await say(h, "B");
    expect(h.redirect.calls).toHaveLength(1);
    expect(h.worker.counts.releases).toBe(1);
    expect(h.worker.counts.wrapUps).toBe(0);
    expect(h.worker.requests).toHaveLength(1);
  });

  test("gives the work trigger the last two exchanges and sends the request when it fires", async () => {
    vi.useFakeTimers();
    const h = build({
      replies: ["a", "b", "c"],
      trigger: [false, false, true],
    });
    await say(h, "A");
    await say(h, "B");
    await say(h, "C");
    expect(h.trigger.calls[2]).toEqual({
      exchanges: [
        { utterance: "B", reply: "b" },
        { utterance: "C", reply: "c" },
      ],
    });
    expect(h.worker.requests.map((r) => r.text)).toEqual(["Q:B/b,C/c"]);
  });

  test("sends no request when the work trigger does not fire", async () => {
    vi.useFakeTimers();
    const h = build({ trigger: [false] });
    await say(h, "A");
    expect(h.trigger.calls).toHaveLength(1);
    expect(h.worker.requests).toHaveLength(0);
  });

  test("gives the wording the request cut at the limit and the tool activity of the run", async () => {
    vi.useFakeTimers();
    const h = build({ work: "0123456789abc" });
    await startWork(h);
    h.worker.emit(toolCall("bash", '{"command":"ls"}'));
    h.worker.emit(toolResult("ok"));
    await say(h, "どう？");
    const status = h.statuses.at(-1)?.status;
    expect(status?.request).toEqual({
      text: "0123456789",
      omitted: 3,
    });
    expect(status?.tools).toEqual([
      { name: "bash", arguments: '{"command":"ls"}', result: "ok" },
    ]);
  });

  test("asks the report judge with the result and reports it on speak", async () => {
    vi.useFakeTimers();
    const h = build({
      work: "直して",
      replies: ["a"],
      report: ["speak"],
    });
    await startWork(h);
    h.worker.end(stopped());
    await settle();
    expect(h.report.calls).toEqual([
      { said: "a", result: "res:stop:完了" },
    ]);
    expect(h.talker.calls.map((c) => c.message)).toEqual([
      "M:idle:A",
      "P:idle",
    ]);
    expect(h.worker.counts.releases).toBe(1);
  });

  test("speaks nothing when the report judge answers defer", async () => {
    vi.useFakeTimers();
    const h = build({
      work: "直して",
      replies: ["a"],
      report: ["defer"],
    });
    await startWork(h);
    h.worker.end(stopped());
    await settle();
    expect(h.report.calls).toHaveLength(1);
    expect(h.talker.calls).toHaveLength(1);
  });

  test("neither judges nor reports work that was wrapped up", async () => {
    vi.useFakeTimers();
    const h = build({ work: "直して", report: ["speak"] });
    await startWork(h);
    h.worker.end({
      kind: "ended",
      reason: "wrapped-up",
      text: "",
      sessionId: "w1",
    });
    await settle();
    expect(h.report.calls).toHaveLength(0);
    expect(h.talker.calls).toHaveLength(1);
  });

  test("reports failed work without asking the report judge", async () => {
    vi.useFakeTimers();
    const h = build({ work: "直して" });
    await startWork(h);
    h.worker.end({ kind: "failed", reason: "boom" });
    await settle();
    expect(h.report.calls).toHaveLength(0);
    expect(h.talker.calls.map((c) => c.message)).toEqual([
      "M:idle:A",
      "P:idle",
    ]);
  });

  test("starts the report reply only after the reply of the utterance being spoken has played", async () => {
    vi.useFakeTimers();
    const h = build({
      work: "直して",
      report: ["speak"],
      player: (index, text) =>
        text === 1 && index === 0
          ? "hold"
          : Promise.resolve({ played: true }),
    });
    await startWork(h);
    const call = await hear(h);
    call.partial("あ");
    await settle();
    h.worker.end(stopped());
    await settle();
    expect(h.talker.calls).toHaveLength(1);
    call.final("あ");
    await settle();
    expect(h.talker.calls).toHaveLength(2);
    h.player.finishHeld({ played: true });
    await settle();
    expect(h.talker.calls.map((c) => c.message)).toEqual([
      "M:idle:A",
      "M:idle:あ",
      "P:idle",
    ]);
  });

  test("starts the report reply only after the sentence being played has ended", async () => {
    vi.useFakeTimers();
    const h = build({
      work: "直して",
      report: ["speak"],
      replies: ["はい。", "一つ目。二つ目。"],
      player: (index, text) =>
        text === 1 && index === 1
          ? "hold"
          : Promise.resolve({ played: true }),
    });
    await startWork(h);
    await say(h, "B");
    expect(h.player.received.map((r) => r.index)).toEqual([0, 0, 1]);
    h.worker.end(stopped());
    await settle();
    expect(h.talker.calls).toHaveLength(2);
    expect(h.player.received.filter((r) => r.index === 0)).toHaveLength(
      2,
    );
    h.player.finishHeld({ played: true });
    await settle();
    expect(h.talker.calls.map((c) => c.message)).toEqual([
      "M:idle:A",
      "M:running:B",
      "P:idle",
    ]);
    expect(h.player.texts()).toHaveLength(3);
  });

  test("keeps the hold and plays the judgment notice when the redirect judge fails", async () => {
    vi.useFakeTimers();
    const h = build({
      work: "直して",
      redirect: [new JudgeError("redirect", "boom")],
    });
    await startWork(h);
    const call = await hear(h);
    call.partial("あ");
    call.final("あ");
    await settle();
    expect(h.worker.counts.releases).toBe(0);
    expect(h.player.texts()).toContain("notice-judgment");
    expect(h.events).toContainEqual({
      type: "failure",
      what: "redirect",
      reason: "boom",
    });
  });

  test("starts nothing and plays the judgment notice when the work trigger fails", async () => {
    vi.useFakeTimers();
    const h = build({ trigger: [new Error("t-boom")] });
    await say(h, "A");
    expect(h.worker.requests).toHaveLength(0);
    expect(h.player.texts()).toContain("notice-judgment");
    expect(h.events).toContainEqual({
      type: "failure",
      what: "work-trigger",
      reason: "t-boom",
    });
  });

  test("plays the judgment notice and no report when the report judge fails", async () => {
    vi.useFakeTimers();
    const h = build({
      work: "直して",
      report: [new JudgeError("report", "boom")],
    });
    await startWork(h);
    h.worker.end(stopped());
    await settle();
    expect(h.player.texts()).toContain("notice-judgment");
    expect(h.talker.calls).toHaveLength(1);
    expect(h.events).toContainEqual({
      type: "failure",
      what: "report",
      reason: "boom",
    });
  });

  test("drops the utterance, keeps the hold and plays the transcription notice when the transcriber fails", async () => {
    vi.useFakeTimers();
    const h = build({ work: "直して" });
    await startWork(h);
    const call = await hear(h);
    call.partial("あ");
    await settle();
    call.fail(new Error("net"));
    await settle();
    expect(h.talker.calls).toHaveLength(1);
    expect(h.worker.counts.holds).toBe(1);
    expect(h.worker.counts.releases).toBe(0);
    expect(h.player.texts()).toContain("notice-transcription");
    expect(h.events).toContainEqual({
      type: "failure",
      what: "transcriber",
      reason: "net",
    });
  });

  test("plays the talker notice and asks no judgment when the talker fails", async () => {
    vi.useFakeTimers();
    const h = build({
      replies: [() => Promise.reject(new TalkerError("down"))],
    });
    await say(h, "A");
    expect(h.player.texts()).toContain("notice-talker");
    expect(h.redirect.calls).toHaveLength(0);
    expect(h.trigger.calls).toHaveLength(0);
    expect(h.events).toContainEqual({
      type: "failure",
      what: "talker",
      reason: "down",
    });
  });

  test("keeps the hold and shows a failure when the stop judge fails during speech", async () => {
    vi.useFakeTimers();
    const h = build({
      work: "直して",
      stop: [new JudgeError("stop", "boom")],
    });
    await startWork(h);
    const call = await hear(h);
    call.partial("あ");
    await vi.advanceTimersByTimeAsync(100);
    expect(h.worker.counts.holds).toBe(1);
    expect(h.worker.counts.releases).toBe(0);
    expect(h.events).toContainEqual({
      type: "failure",
      what: "stop",
      reason: "boom",
    });
  });

  test("rejects with the error of a player device failure", async () => {
    vi.useFakeTimers();
    const error = new Error("no device");
    const h = build({ player: () => Promise.reject(error) });
    await say(h, "A");
    expect(h.outcome).toEqual({ status: "rejected", error });
  });

  test("rejects with the error of a listener failure", async () => {
    vi.useFakeTimers();
    const error = new Error("mic");
    const h = build();
    h.listener.fail(error);
    await settle();
    expect(h.outcome).toEqual({ status: "rejected", error });
  });

  test("stops playback, aborts the talker and the worker and rejects with the reason when aborted", async () => {
    vi.useFakeTimers();
    const reason = new Error("interrupted");
    const h = build({
      work: "直して",
      player: (_index, text) =>
        text === 1 ? "hold" : Promise.resolve({ played: true }),
    });
    await startWork(h);
    await say(h, "B");
    expect(h.player.received).toHaveLength(2);
    h.abort.abort(reason);
    await settle();
    expect(h.player.stopCalls).toBeGreaterThan(0);
    expect(h.talker.calls[1]?.options.signal.aborted).toBe(true);
    expect(h.worker.requests[0]?.options.signal.aborted).toBe(true);
    expect(h.outcome).toEqual({ status: "rejected", error: reason });
  });

  test("resolves after the reply has played when the listener ends", async () => {
    vi.useFakeTimers();
    const h = build({
      player: () => "hold",
    });
    h.listener.utter();
    h.listener.end();
    await settle();
    h.transcriber.calls[0]?.final("A");
    await settle();
    expect(h.player.received).toHaveLength(1);
    expect(h.outcome.status).toBe("pending");
    h.player.finishHeld({ played: true });
    await settle();
    expect(h.outcome.status).toBe("resolved");
  });

  test("records one cycle span per utterance with the judgments and the runs it started under it", async () => {
    vi.useFakeTimers();
    const root = new RecordingSpan("root");
    const h = build({
      work: "直して",
      trace: root,
      judgeSpans: true,
      stop: ["stop"],
      redirect: ["switch"],
    });
    await startWork(h);
    const call = await hear(h);
    call.partial("あ");
    await vi.advanceTimersByTimeAsync(100);
    call.final("あ");
    await settle();
    h.worker.end({
      kind: "ended",
      reason: "wrapped-up",
      text: "",
      sessionId: "w1",
    });
    await settle();
    expect(root.children.map((c) => c.name)).toEqual([
      SPAN.dialogue,
      SPAN.dialogue,
    ]);
    const cycle = root.children[1];
    const judges = cycle?.children
      .filter((c) => c.name === SPAN.turn)
      .map((c) => c.attributes[ATTR.turnJudge]);
    expect(judges).toEqual(["stop", "redirect"]);
    const runs = cycle?.children
      .filter((c) => c.name === SPAN.dialogueRun)
      .map((c) => [
        c.attributes[ATTR.dialogueRole],
        c.mergedAttributes[ATTR.runSession],
      ]);
    expect(runs).toEqual([
      ["talker", "t1"],
      ["worker", "w2"],
    ]);
  });

  test("stops after the last played sentence and shows a synthesizer failure when the synthesizer fails", async () => {
    vi.useFakeTimers();
    const h = build({
      work: "直して",
      replies: ["はい。", "一つ目。二つ目。"],
      synthesizerFailsOn: "二つ目。",
    });
    await startWork(h);
    const call = await hear(h);
    call.partial("あ");
    call.final("あ");
    await settle();
    expect(
      h.player.received.filter((r) => r.text.startsWith("notice")),
    ).toEqual([]);
    expect(h.redirect.calls).toHaveLength(0);
    expect(h.trigger.calls).toHaveLength(1);
    expect(h.worker.counts.holds).toBe(1);
    expect(h.worker.counts.releases).toBe(0);
    expect(h.events).toContainEqual({
      type: "failure",
      what: "synthesizer",
      reason: "quota",
    });
  });

  test("keeps the ending of the earlier work in the status while new work runs, until the new work ends", async () => {
    vi.useFakeTimers();
    const h = build({ work: "直して", redirect: ["switch"] });
    await startWork(h);
    await say(h, "B");
    h.worker.end({
      kind: "ended",
      reason: "wrapped-up",
      text: "",
      sessionId: "w1",
    });
    await settle();
    expect(h.worker.requests).toHaveLength(2);
    await say(h, "C");
    const running = h.statuses.at(-1)?.status;
    expect(running?.state).toBe("running");
    expect(running?.request).toEqual({
      text: "Q:A/はい。,B/",
      omitted: 3,
    });
    expect(running?.latest).toMatchObject({
      kind: "ended",
      reason: "wrapped-up",
    });
    h.worker.end({
      kind: "ended",
      reason: "stop",
      text: "完了",
      sessionId: "w2",
    });
    await settle();
    await say(h, "D");
    expect(h.statuses.at(-1)?.status.latest).toMatchObject({
      kind: "ended",
      reason: "stop",
      text: "完了",
    });
  });

  test("emits utterance-end once the audio has ended and before the final transcript", async () => {
    vi.useFakeTimers();
    const h = build();
    const audio = h.listener.utterOpen();
    await settle();
    const call = h.transcriber.calls.at(-1);
    if (call === undefined) throw new Error("no transcription started");
    expect(h.events.map(describeEvent)).toEqual(["utterance"]);
    audio.end();
    await settle();
    call.final("こんにちは");
    await settle();
    expect(h.events.map(describeEvent).slice(0, 3)).toEqual([
      "utterance",
      "utterance-end",
      "transcript:こんにちは:true",
    ]);
  });

  test("emits utterance-end once when the transcriber fails after the audio ended", async () => {
    vi.useFakeTimers();
    const h = build();
    const audio = h.listener.utterOpen();
    await settle();
    audio.end();
    await settle();
    h.transcriber.calls.at(-1)?.fail(new Error("net"));
    await settle();
    expect(
      h.events.filter((e) => e.type === "utterance-end"),
    ).toHaveLength(1);
  });

  test("emits no utterance-end when the session is aborted while the audio is open", async () => {
    vi.useFakeTimers();
    const h = build();
    const audio = h.listener.utterOpen();
    await settle();
    h.abort.abort(new Error("stop"));
    audio.end();
    await settle();
    expect(h.events.map(describeEvent)).toEqual(["utterance"]);
  });

  test("emits the events of one cycle in order", async () => {
    vi.useFakeTimers();
    const h = build({ work: "直して", stop: ["stop"] });
    await startWork(h);
    const before = h.events.length;
    const call = await hear(h);
    call.partial("ちが");
    await vi.advanceTimersByTimeAsync(100);
    call.final("ちがう");
    await settle();
    const expected = [
      "transcript:ちが:false",
      "work:held",
      "judgment:stop:stop",
      "transcript:ちがう:true",
      "reply:はい。",
      "judgment:redirect:continue",
      "work:released",
    ];
    expect(
      h.events
        .slice(before)
        .map(describeEvent)
        .filter((e) => expected.includes(e)),
    ).toEqual(expected);
  });

  test("plays the reply, settles the heard count and resolves the talker when the text is complete", async () => {
    vi.useFakeTimers();
    const h = build();
    await say(h, "A");
    expect(h.player.received).toEqual([{ index: 0, text: "はい。" }]);
    expect(h.talker.heard).toEqual([3]);
    expect(h.talker.resolved).toEqual([0]);
  });

  test("stops playback at once and plays the notice when the talker fails before its text is complete", async () => {
    vi.useFakeTimers();
    const h = build({
      replies: [
        async (_message, options) => {
          options.onText("一つ目。二つ目");
          await new Promise((resolve) => setTimeout(resolve, 0));
          throw new TalkerError("length");
        },
      ],
      player: (index, text) =>
        text === 0 && index === 0
          ? "hold"
          : Promise.resolve({ played: true }),
    });
    await say(h, "A");
    expect(
      h.player.received.filter((r) => r.text !== "notice-talker"),
    ).toEqual([{ index: 0, text: "一つ目。" }]);
    expect(h.player.log).toEqual([
      "play:0:一つ目。",
      "stop",
      "play:0:notice-talker",
    ]);
    expect(h.redirect.calls).toHaveLength(0);
    expect(h.trigger.calls).toHaveLength(0);
    expect(h.events).toContainEqual({
      type: "failure",
      what: "talker",
      reason: "length",
    });
  });

  test("plays the reply in full and then the notice when the talker fails after its text is complete", async () => {
    vi.useFakeTimers();
    const h = build({
      work: "直して",
      replies: [
        "はい。",
        async (_message, options) => {
          options.onText("はい。");
          options.onTextEnd();
          await options.heard;
          throw new TalkerError("append-failed");
        },
      ],
    });
    await startWork(h);
    await say(h, "B");
    expect(h.player.log.slice(-2)).toEqual([
      "play:0:はい。",
      "play:0:notice-talker",
    ]);
    expect(h.redirect.calls).toHaveLength(0);
    expect(h.events).toContainEqual({
      type: "failure",
      what: "talker",
      reason: "append-failed",
    });
  });
});
