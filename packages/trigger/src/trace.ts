import {
  noopSpan,
  type TraceAttributes,
  type TraceSpan,
} from "@mg/harness";
import { ATTR, endSpan, setSpanAttributes, SPAN } from "@mg/trace";
import type { TriggerContext, TriggerDecision } from "./types.js";

export const withTriggerSpan = async (
  context: TriggerContext | undefined,
  attributes: TraceAttributes,
  body: (span: TraceSpan) => Promise<TriggerDecision>,
): Promise<TriggerDecision> => {
  if (context?.trace === undefined) {
    return body(noopSpan);
  }

  let span: TraceSpan;
  try {
    span = context.trace.startSpan(SPAN.trigger, {
      [ATTR.op]: "trigger",
      ...attributes,
    });
  } catch {
    span = noopSpan;
  }

  try {
    const decision = await body(span);
    setSpanAttributes(span, {
      [ATTR.triggerFired]: decision.fired,
      [ATTR.triggerReason]: decision.reason,
    });
    endSpan(span);
    return decision;
  } catch (error) {
    endSpan(span, error);
    throw error;
  }
};
