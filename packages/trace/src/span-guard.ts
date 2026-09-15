import type { TraceAttributes, TraceSpan } from "@mg/harness";

export const setSpanAttributes = (
  span: TraceSpan,
  attributes: TraceAttributes,
): void => {
  try {
    span.setAttributes(attributes);
  } catch {}
};

export const endSpan = (span: TraceSpan, error?: unknown): void => {
  try {
    span.end(error);
  } catch {}
};
