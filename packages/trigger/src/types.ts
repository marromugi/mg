import type { TraceSpan } from "@mg/harness";

export type TriggerContext = {
  signal?: AbortSignal;
  trace?: TraceSpan;
};

export type TriggerDecision = { fired: boolean; reason: string };

export interface Trigger<TInput> {
  decide(
    input: TInput,
    context?: TriggerContext,
  ): Promise<TriggerDecision>;
}
