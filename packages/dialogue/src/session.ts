import {
  noopSpan,
  type TraceAttributes,
  type TraceSpan,
} from "@mg/harness";
import { ATTR, endSpan, setSpanAttributes, SPAN } from "@mg/trace";
import type { Exchange } from "@mg/turn";
import type { HeardUtterance, Player } from "@mg/voice";
import { TalkerError } from "./errors.js";
import {
  createReplySpeaker,
  type ReplySpeaker,
} from "./reply-speaker.js";
import { buildStatus, createToolLog, type ToolLog } from "./status.js";
import type {
  DialogueEvent,
  RunDialogue,
  WorkEnding,
  WorkStatus,
} from "./types.js";

type Work = {
  request: string;
  held: boolean;
  tools: ToolLog;
  // settles once the ending of the run is recorded
  ended: Promise<void>;
};

type ReplyResult =
  | { kind: "played" | "cut" | "unfinished"; heard: string }
  | { kind: "failed" };

type ReplyRecord = {
  kind: "reply" | "report";
  cut: boolean;
  // true from the start of the reply until its playback has ended
  playing: boolean;
  speaker?: ReplySpeaker;
  wrapUp?: AbortController;
};

type FailureWhat = Extract<DialogueEvent, { type: "failure" }>["what"];

const reasonOf = (error: unknown): string => {
  if (error instanceof TalkerError) return error.reason;
  return error instanceof Error ? error.message : String(error);
};

const attempt = <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return call();
  } catch (error) {
    return Promise.reject(error);
  }
};

const startSpan = (
  parent: TraceSpan,
  name: string,
  attributes: TraceAttributes,
): TraceSpan => {
  try {
    return parent.startSpan(name, attributes);
  } catch {
    return noopSpan;
  }
};

const startRun = (parent: TraceSpan, role: "talker" | "worker") =>
  startSpan(parent, SPAN.dialogueRun, {
    [ATTR.op]: "dialogue.run",
    [ATTR.dialogueRole]: role,
  });

export const runDialogue: RunDialogue = async (options, context) => {
  const { transcriber, synthesizer, judges, talker, worker, wording } =
    options;
  const parent = context.trace ?? noopSpan;
  const internal = new AbortController();
  const signal = internal.signal;

  const emit = (event: DialogueEvent) => {
    try {
      context.onEvent?.(event);
    } catch {
      // A listener of events cannot break the session.
    }
  };

  let over = false;
  const replies = new Set<ReplyRecord>();
  let speaking: ReplySpeaker | null = null;
  let fatal!: (error: unknown) => void;
  const terminal = new Promise<never>((_, reject) => {
    fatal = (error) => {
      if (over) return;
      over = true;
      internal.abort(error);
      speaking?.stop();
      reject(error);
    };
  });
  terminal.catch(() => {});

  const onAbort = () => fatal(context.signal.reason);
  if (context.signal.aborted) onAbort();
  else
    context.signal.addEventListener("abort", onAbort, { once: true });

  // Keeps the error of a device failure, which the speaker reports as text.
  let playerError: { error: unknown } | undefined;
  let playing = 0;
  let playedUntil = Number.NEGATIVE_INFINITY;
  const player: Player = {
    async play(index, audio) {
      playing += 1;
      try {
        return await options.player.play(index, audio);
      } catch (error) {
        playerError = { error };
        throw error;
      } finally {
        playing -= 1;
        if (playing === 0) playedUntil = Date.now();
      }
    },
    stop: () => options.player.stop(),
  };

  const failure = (what: FailureWhat, error: unknown) => {
    if (over) return;
    emit({ type: "failure", what, reason: reasonOf(error) });
  };

  const background = new Set<Promise<void>>();
  const track = (promise: Promise<unknown>) => {
    const tracked: Promise<void> = promise
      .then(
        () => {},
        (error: unknown) => fatal(error),
      )
      .then(() => void background.delete(tracked));
    background.add(tracked);
  };

  // A run of the worker is not waited for when the session ends.
  const detach = (promise: Promise<unknown>) => {
    promise.then(
      () => {},
      (error: unknown) => fatal(error),
    );
  };

  const watch = (
    speaker: ReplySpeaker,
    onSynthesizerFailure?: () => void,
  ) =>
    speaker.done.then((outcome) => {
      if (outcome.failed === "device") {
        fatal(playerError?.error ?? new Error(outcome.reason));
      } else if (outcome.failed === "synthesizer") {
        failure("synthesizer", outcome.reason);
        onSynthesizerFailure?.();
      }
      return outcome;
    });

  // One text at a time: a job starts once the one before it has ended.
  let speechTail: Promise<unknown> = Promise.resolve();
  const speech = <T>(job: () => Promise<T>): Promise<T | undefined> => {
    const run = speechTail.then(() => (over ? undefined : job()));
    speechTail = run.catch(() => {});
    return run;
  };

  const playNotice = async (text: string) => {
    const speaker = createReplySpeaker({ synthesizer, player });
    speaking = speaker;
    speaker.push(text);
    speaker.end();
    await watch(speaker);
    speaking = null;
  };
  const speakNotice = (text: string) => speech(() => playNotice(text));

  const exchanges: Exchange[] = [];
  let work: Work | null = null;
  let latest: WorkEnding | null = null;
  let inProgress = 0;
  let pendingReports: WorkStatus[] = [];

  const status = () => buildStatus(work, latest, options.requestLimit);

  const holdWork = () => {
    if (work === null || work.held) return;
    work.held = true;
    worker.hold();
    emit({ type: "work", action: "held" });
  };

  const releaseWork = () => {
    worker.release();
    if (work?.held) {
      work.held = false;
      emit({ type: "work", action: "released" });
    }
  };

  // A new utterance cuts every reply that has not finished playing,
  // whether it is playing or still waiting for its turn.
  const cutReplies = () => {
    for (const record of replies) {
      if (record.speaker !== undefined) {
        if (!record.playing) continue;
        record.cut = true;
        record.speaker.stop();
        record.wrapUp?.abort();
      } else if (record.kind === "reply") {
        record.cut = true;
      }
    }
  };

  const speakReply = (
    kind: ReplyRecord["kind"],
    buildMessage: () => string,
    span: TraceSpan,
  ): Promise<ReplyResult | undefined> => {
    const record: ReplyRecord = { kind, cut: false, playing: false };
    replies.add(record);
    return speech(async (): Promise<ReplyResult | undefined> => {
      try {
        if (record.cut) {
          emit({ type: "reply-cut", heard: 0 });
          return { kind: "cut", heard: "" };
        }
        const message = buildMessage();
        const speaker = createReplySpeaker({ synthesizer, player });
        const wrapUp = new AbortController();
        record.speaker = speaker;
        record.wrapUp = wrapUp;
        record.playing = true;
        speaking = speaker;
        const outcomeDone = watch(speaker, () => wrapUp.abort()).then(
          (outcome) => {
            record.playing = false;
            return outcome;
          },
        );
        const heard = outcomeDone.then((outcome) => outcome.heard);
        const run = startRun(span, "talker");
        let text = "";
        let talkerFailure: { error: unknown } | undefined;
        try {
          const result = await talker.reply(message, {
            signal,
            wrapUp: wrapUp.signal,
            heard,
            onText: (delta) => {
              text += delta;
              emit({ type: "reply-text", delta });
              speaker.push(delta);
            },
            onTextEnd: () => speaker.end(),
          });
          setSpanAttributes(run, {
            [ATTR.runSession]: result.sessionId,
          });
          endSpan(run);
        } catch (error) {
          talkerFailure = { error };
          endSpan(run, error);
        }
        if (over) return undefined;

        if (talkerFailure !== undefined) {
          speaker.stop();
          await outcomeDone;
          failure("talker", talkerFailure.error);
          await playNotice(wording.notices.talker);
          return { kind: "failed" };
        }

        const outcome = await outcomeDone;
        speaking = null;
        if (over) return undefined;
        const heardText = text.slice(0, outcome.heard);
        emit({ type: "reply", text: heardText });
        if (
          record.cut &&
          (text === "" || heardText.length < text.length)
        ) {
          emit({ type: "reply-cut", heard: outcome.heard });
          return { kind: "cut", heard: heardText };
        }
        if (outcome.failed !== undefined) {
          return { kind: "unfinished", heard: heardText };
        }
        return { kind: "played", heard: heardText };
      } finally {
        replies.delete(record);
      }
    });
  };

  const speakReport = async (reported: WorkStatus) => {
    await speakReply("report", () => wording.report(reported), parent);
  };

  // The report is built from the status at the time the work ended.
  const requestReport = (reported: WorkStatus) => {
    if (inProgress > 0) {
      pendingReports.push(reported);
      return;
    }
    track(speakReport(reported));
  };

  const handleEnding = async (
    current: Work,
    ending: WorkEnding,
    markEnded: () => void,
  ) => {
    if (over) {
      markEnded();
      return;
    }
    if (ending.kind === "failed") failure("worker", ending.reason);
    releaseWork();
    work = null;
    latest = ending;
    emit({ type: "work", action: "ended", ending });
    markEnded();
    const reported = status();
    if (ending.kind === "ended" && ending.reason === "wrapped-up")
      return;
    if (ending.kind === "failed") {
      requestReport(reported);
      return;
    }
    let answer;
    try {
      answer = await judges.report.judge(
        {
          said: exchanges.map((e) => e.reply).join("\n"),
          result: wording.result(ending),
        },
        { signal, trace: parent },
      );
    } catch (error) {
      failure("report", error);
      await speakNotice(wording.notices.judgment);
      return;
    }
    if (over) return;
    emit({ type: "judgment", judge: "report", answer: answer.action });
    if (answer.action === "speak") requestReport(reported);
  };

  const startWork = (text: string, span: TraceSpan) => {
    const run = startRun(span, "worker");
    let markEnded!: () => void;
    const current: Work = {
      request: text,
      held: false,
      tools: createToolLog(),
      ended: new Promise<void>((resolve) => (markEnded = resolve)),
    };
    work = current;
    emit({ type: "work", action: "requested" });
    detach(
      attempt(() =>
        worker.request(text, {
          signal,
          onStart: (sessionId) =>
            setSpanAttributes(run, { [ATTR.runSession]: sessionId }),
          onEvent: (event) => current.tools.add(event),
        }),
      )
        .then(
          (ending) => ending,
          (error: unknown): WorkEnding => ({
            kind: "failed",
            reason: reasonOf(error),
          }),
        )
        .then((ending) => {
          endSpan(
            run,
            ending.kind === "failed"
              ? new Error(ending.reason)
              : undefined,
          );
          return handleEnding(current, ending, markEnded);
        }),
    );
  };

  const handoff = async (recent: Exchange[], span: TraceSpan) => {
    const judgeContext = { signal, trace: span };
    const current = work;
    if (current !== null) {
      let answer;
      try {
        answer = await judges.redirect.judge(
          { exchanges: recent, request: current.request },
          judgeContext,
        );
      } catch (error) {
        failure("redirect", error);
        await speakNotice(wording.notices.judgment);
        return;
      }
      if (over) return;
      emit({
        type: "judgment",
        judge: "redirect",
        answer: answer.action,
      });
      if (work !== current) return;
      releaseWork();
      if (answer.action === "continue") return;
      emit({ type: "work", action: "wrapped-up" });
      worker.wrapUp();
      await current.ended;
      if (over || work !== null) return;
      startWork(wording.request(recent), span);
      return;
    }
    let decision;
    try {
      decision = await options.workTrigger.decide(
        { exchanges: recent },
        judgeContext,
      );
    } catch (error) {
      failure("work-trigger", error);
      await speakNotice(wording.notices.judgment);
      return;
    }
    if (over) return;
    emit({
      type: "judgment",
      judge: "work-trigger",
      answer: decision.fired ? "fired" : "not fired",
    });
    if (decision.fired && work === null) {
      startWork(wording.request(recent), span);
    }
  };

  // Returns the final text, or undefined when the utterance was dropped.
  const listen = async (
    utterance: HeardUtterance,
    span: TraceSpan,
  ): Promise<string | undefined> => {
    let text = "";
    let final: string | undefined;
    let firstSeen = false;
    let ended = false;
    let asking = false;
    let lastAsked: string | undefined;
    let transcriberFailure: { error: unknown } | undefined;

    const check = () => {
      const current = work;
      if (
        ended ||
        asking ||
        current === null ||
        text === "" ||
        text === lastAsked
      ) {
        return;
      }
      asking = true;
      lastAsked = text;
      track(
        attempt(() =>
          judges.stop.judge(
            {
              utterance: text,
              work: {
                request: current.request,
                tools: current.tools.activity.map((tool) => ({
                  ...tool,
                })),
              },
            },
            { signal, trace: span },
          ),
        )
          .then(
            (answer) => {
              if (over) return;
              emit({
                type: "judgment",
                judge: "stop",
                answer: answer.action,
              });
              if (ended || work !== current) return;
              if (answer.action === "stop") holdWork();
              else releaseWork();
            },
            (error: unknown) => failure("stop", error),
          )
          .then(() => {
            asking = false;
          }),
      );
    };
    const timer = setInterval(check, options.stopCheckMs);

    const audio = (async function* () {
      yield* utterance.audio;
      if (!over) emit({ type: "utterance-end" });
    })();
    try {
      for await (const event of transcriber.transcribe(audio, {
        signal,
        languages: options.languages,
      })) {
        if (over) return undefined;
        if (event.type === "partial") {
          text = event.text;
          emit({ type: "transcript", text, final: false });
          if (!firstSeen && text !== "") {
            firstSeen = true;
            try {
              holdWork();
            } catch (error) {
              fatal(error);
              return undefined;
            }
          }
        } else {
          final = event.text;
          text = event.text;
          ended = true;
          emit({ type: "transcript", text, final: true });
        }
      }
    } catch (error) {
      transcriberFailure = { error };
    } finally {
      ended = true;
      clearInterval(timer);
    }
    if (over) return undefined;
    if (transcriberFailure !== undefined) {
      failure("transcriber", transcriberFailure.error);
      await speakNotice(wording.notices.transcription);
      return undefined;
    }
    return final ?? text;
  };

  const cycle = async (utterance: HeardUtterance) => {
    const span = startSpan(parent, SPAN.dialogue, {
      [ATTR.op]: "dialogue",
    });
    inProgress += 1;
    try {
      emit({ type: "utterance" });
      cutReplies();
      const heardText = await listen(utterance, span);
      if (heardText === undefined) return;
      const result = await speakReply(
        "reply",
        () => wording.message(status(), heardText),
        span,
      );
      if (result === undefined || result.kind === "failed") return;
      exchanges.push({ utterance: heardText, reply: result.heard });
      exchanges.splice(
        0,
        Math.max(0, exchanges.length - options.exchangeCount),
      );
      if (result.kind !== "played") return;
      await handoff([...exchanges], span);
    } finally {
      inProgress -= 1;
      endSpan(span);
      if (inProgress === 0 && pendingReports.length > 0) {
        const reports = pendingReports;
        pendingReports = [];
        for (const reported of reports) track(speakReport(reported));
      }
    }
  };

  const setAside = (): boolean => {
    const { whileSpeaking } = options;
    if (whileSpeaking.kind === "interrupt") return false;
    return (
      playing > 0 || Date.now() - playedUntil < whileSpeaking.tailMs
    );
  };

  const ignore = async (utterance: HeardUtterance) => {
    emit({ type: "utterance-ignored" });
    for await (const chunk of utterance.audio) void chunk;
  };

  const main = async () => {
    try {
      for await (const utterance of options.listener.listen(signal)) {
        if (over) break;
        track(setAside() ? ignore(utterance) : cycle(utterance));
      }
    } catch (error) {
      fatal(error);
      return;
    }
    while (background.size > 0) await Promise.all(background);
  };

  const running = main();
  running.catch(() => {});
  try {
    await Promise.race([running, terminal]);
  } finally {
    over = true;
    internal.abort();
    context.signal.removeEventListener("abort", onAbort);
  }
};
