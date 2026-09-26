import {
  noopSpan,
  type TraceAttributes,
  type TraceSpan,
} from "@mg/harness";
import { ATTR, endSpan, SPAN } from "@mg/trace";
import type { JudgeContext, JudgeName } from "./types.js";

export const withTurnSpan = async <T>(
  context: JudgeContext | undefined,
  judge: JudgeName,
  attributes: TraceAttributes,
  body: (span: TraceSpan) => Promise<T>,
): Promise<T> => {
  if (context?.trace === undefined) {
    return body(noopSpan);
  }

  let span: TraceSpan;
  try {
    span = context.trace.startSpan(SPAN.turn, {
      [ATTR.op]: "turn",
      [ATTR.turnJudge]: judge,
      ...attributes,
    });
  } catch {
    span = noopSpan;
  }

  try {
    const result = await body(span);
    endSpan(span);
    return result;
  } catch (error) {
    endSpan(span, error);
    throw error;
  }
};
