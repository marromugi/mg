import type { TraceSpan } from "@mg/harness";

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

export type ToolActivity = {
  name: string;
  arguments: string;
  result: string | null;
};
export type WorkSpeechSituation = {
  tools: ToolActivity[];
  elapsedMs: number;
};
export type WorkSpeechAnswer =
  | { action: "report" }
  | { action: "fill"; text: string }
  | { action: "silent" };

export type StopSituation = { utterance: string };
export type StopAnswer = { action: "stop" } | { action: "continue" };

export type Exchange = { utterance: string; reply: string };
export type RedirectSituation = {
  exchanges: Exchange[];
  request: string;
};
export type RedirectAnswer =
  { action: "switch" } | { action: "continue" };

export type ReportSituation = { said: string; result: string };
export type ReportAnswer = { action: "speak" } | { action: "defer" };

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
