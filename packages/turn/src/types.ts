import type { TraceSpan } from "@mg/harness";

// both optional; the span, when given, is the parent of the judgment's span
export type JudgeContext = { signal?: AbortSignal; trace?: TraceSpan };

export interface Judge<TSituation, TAnswer> {
  judge(
    situation: TSituation,
    context?: JudgeContext,
  ): Promise<TAnswer>;
}

export type BackchannelSituation = { interim: string };
export type BackchannelAnswer =
  { action: "backchannel"; text: string } | { action: "none" };

// one tool call of the work so far, oldest first; result is null while
// the call is still running
export type ToolActivity = {
  name: string;
  arguments: string;
  result: string | null;
};
// tool history, elapsed time since the work started
export type WorkSpeechSituation = {
  tools: ToolActivity[];
  elapsedMs: number;
};
export type WorkSpeechAnswer =
  | { action: "report" }
  | { action: "fill"; text: string }
  | { action: "silent" };

// what the partner said during the work
export type StopSituation = { utterance: string };
export type StopAnswer = { action: "stop" } | { action: "continue" };

// one exchange: what the partner said, and what we replied
export type Exchange = { utterance: string; reply: string };
// the recent exchanges, oldest first, as many as the caller chose to
// pass; the work's request
export type RedirectSituation = {
  exchanges: Exchange[];
  request: string;
};
export type RedirectAnswer =
  { action: "switch" } | { action: "continue" };

// what has been spoken so far, the work result
export type ReportSituation = { said: string; result: string };
export type ReportAnswer = { action: "speak" } | { action: "defer" };

// the running work's request, the new request
export type OverlapSituation = { running: string; request: string };
export type OverlapAnswer = { action: "replace" } | { action: "queue" };

export type BackchannelJudge = Judge<
  BackchannelSituation,
  BackchannelAnswer
>;
export type WorkSpeechJudge = Judge<
  WorkSpeechSituation,
  WorkSpeechAnswer
>;
export type StopJudge = Judge<StopSituation, StopAnswer>;
export type RedirectJudge = Judge<RedirectSituation, RedirectAnswer>;
export type ReportJudge = Judge<ReportSituation, ReportAnswer>;
export type OverlapJudge = Judge<OverlapSituation, OverlapAnswer>;

export type JudgeName =
  | "backchannel"
  | "work-speech"
  | "stop"
  | "redirect"
  | "report"
  | "overlap";
