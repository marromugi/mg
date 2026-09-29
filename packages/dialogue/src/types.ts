import type {
  HarnessEvent,
  HarnessStopReason,
  TraceSpan,
} from "@mg/harness";
import type { Trigger } from "@mg/trigger";
import type {
  Exchange,
  RedirectJudge,
  ReportJudge,
  StopJudge,
  ToolActivity,
} from "@mg/turn";
import type {
  Listener,
  Player,
  SpeechSynthesizer,
  Transcriber,
} from "@mg/voice";

export type TalkerReplyOptions = {
  signal: AbortSignal;
  wrapUp: AbortSignal;
  // settles with how many characters of the reply text the person heard
  heard: Promise<number>;
  onText: (delta: string) => void;
  onTextEnd: () => void;
};

// onTextEnd is called once, after the last onText, when the generation
// finished on its own and before the talker awaits heard. It is not
// called when the generation fails, stops at a length or turn limit
// (reply rejects with TalkerError naming the stop reason), or is
// wrapped up (the talker awaits heard and saves).
// reply rejects with TalkerError when the run fails or is not saved; a
// reply that cannot be saved rejects after onTextEnd was called.
export interface Talker {
  reply(
    message: string,
    options: TalkerReplyOptions,
  ): Promise<{ sessionId: string }>;
}

export type WorkEnding =
  | {
      kind: "ended";
      reason: HarnessStopReason;
      text: string;
      sessionId: string;
    }
  | { kind: "failed"; reason: string };

export type WorkRequestOptions = {
  signal: AbortSignal;
  onStart: (sessionId: string) => void;
  onEvent: (event: HarnessEvent) => void;
};

export interface Worker {
  request(
    text: string,
    options: WorkRequestOptions,
  ): Promise<WorkEnding>;
  hold(): void;
  release(): void;
  wrapUp(): void;
}

export type WorkTriggerInput = { exchanges: Exchange[] };

export type WorkStatus = {
  state: "idle" | "running" | "held";
  // omitted counts the characters cut from the request text
  request: { text: string; omitted: number } | null;
  tools: ToolActivity[];
  latest: WorkEnding | null;
};

export type DialogueWording = {
  message(status: WorkStatus, utterance: string): string;
  report(status: WorkStatus): string;
  request(exchanges: Exchange[]): string;
  result(ending: WorkEnding): string;
  notices: { judgment: string; transcription: string; talker: string };
};

export type DialogueOptions = {
  listener: Listener;
  transcriber: Transcriber;
  languages?: readonly string[];
  synthesizer: SpeechSynthesizer;
  player: Player;
  judges: {
    stop: StopJudge;
    redirect: RedirectJudge;
    report: ReportJudge;
  };
  workTrigger: Trigger<WorkTriggerInput>;
  talker: Talker;
  worker: Worker;
  wording: DialogueWording;
  stopCheckMs: number;
  exchangeCount: number;
  requestLimit: number;
};

export type DialogueEvent =
  | { type: "utterance" }
  | { type: "transcript"; text: string; final: boolean }
  | { type: "reply-text"; delta: string }
  // text is the part of the reply the person heard
  | { type: "reply"; text: string }
  | { type: "reply-cut"; heard: number }
  | {
      type: "work";
      action: "held" | "released" | "wrapped-up" | "requested";
    }
  | { type: "work"; action: "ended"; ending: WorkEnding }
  | {
      type: "judgment";
      judge: "stop" | "redirect" | "report" | "work-trigger";
      answer: string;
    }
  | {
      type: "failure";
      what:
        | "stop"
        | "redirect"
        | "report"
        | "work-trigger"
        | "transcriber"
        | "talker"
        | "synthesizer"
        | "worker";
      reason: string;
    };

export type DialogueContext = {
  signal: AbortSignal;
  trace?: TraceSpan;
  onEvent?: (event: DialogueEvent) => void;
};

export type RunDialogue = (
  options: DialogueOptions,
  context: DialogueContext,
) => Promise<void>;
