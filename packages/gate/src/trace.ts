import {
  noopSpan,
  type TraceAttributes,
  type TraceSpan,
} from "@mg/harness";
import { ATTR, endSpan, setSpanAttributes, SPAN } from "@mg/trace";
import type { GateContext, GateRequest, Verdict } from "./types.js";

export const withGateSpan = async (
  context: GateContext | undefined,
  request: GateRequest,
  attributes: TraceAttributes,
  body: (span: TraceSpan) => Promise<Verdict>,
): Promise<Verdict> => {
  if (context?.trace === undefined) {
    return body(noopSpan);
  }

  let span: TraceSpan;
  try {
    span = context.trace.startSpan(SPAN.gate, {
      [ATTR.op]: "gate",
      [ATTR.gateKind]: request.kind,
      [ATTR.gateDescription]: request.description,
      ...attributes,
    });
  } catch {
    span = noopSpan;
  }

  try {
    const verdict = await body(span);
    setSpanAttributes(span, {
      [ATTR.gateAllowed]: verdict.allowed,
      [ATTR.gateReason]: verdict.reason,
    });
    endSpan(span);
    return verdict;
  } catch (error) {
    endSpan(span, error);
    throw error;
  }
};
