import { ROOT_CONTEXT, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Span, Tracer } from "@opentelemetry/api";
import { noopSpan } from "@mg/harness";
import type { TraceAttributes, TraceSpan } from "@mg/harness";

class OtelSpan implements TraceSpan {
  constructor(
    private readonly tracer: Tracer,
    private readonly span: Span,
  ) {}

  startSpan(name: string, attributes?: TraceAttributes): TraceSpan {
    try {
      const child = this.tracer.startSpan(
        name,
        { attributes },
        trace.setSpan(ROOT_CONTEXT, this.span),
      );
      return new OtelSpan(this.tracer, child);
    } catch {
      return noopSpan;
    }
  }

  setAttributes(attributes: TraceAttributes): void {
    // Recording must never break the caller: every span call below is guarded.
    try {
      this.span.setAttributes(attributes);
    } catch {}
  }

  addEvent(name: string, attributes?: TraceAttributes): void {
    try {
      this.span.addEvent(name, attributes);
    } catch {}
  }

  end(error?: unknown): void {
    try {
      if (error !== undefined) {
        const exception = error instanceof Error ? error : String(error);
        this.span.recordException(exception);
        this.span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } catch {}

    try {
      this.span.end();
    } catch {}
  }
}

export const startRootSpan = (
  tracer: Tracer,
  name: string,
  attributes?: TraceAttributes,
): TraceSpan => {
  try {
    const span = tracer.startSpan(name, { attributes }, ROOT_CONTEXT);
    return new OtelSpan(tracer, span);
  } catch {
    return noopSpan;
  }
};
