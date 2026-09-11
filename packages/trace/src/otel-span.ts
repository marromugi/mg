import { ROOT_CONTEXT, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Span, Tracer } from "@opentelemetry/api";
import type { TraceAttributes, TraceSpan } from "@mg/harness";

export class OtelSpan implements TraceSpan {
  constructor(
    private readonly tracer: Tracer,
    private readonly span: Span,
  ) {}

  startSpan(name: string, attributes?: TraceAttributes): TraceSpan {
    const child = this.tracer.startSpan(
      name,
      { attributes },
      trace.setSpan(ROOT_CONTEXT, this.span),
    );
    return new OtelSpan(this.tracer, child);
  }

  setAttributes(attributes: TraceAttributes): void {
    try {
      this.span.setAttributes(attributes);
    } catch {
      // recording must never break the caller
    }
  }

  addEvent(name: string, attributes?: TraceAttributes): void {
    try {
      this.span.addEvent(name, attributes);
    } catch {
      // recording must never break the caller
    }
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
      this.span.end();
    } catch {
      // recording must never break the caller
    }
  }
}

export const startRootSpan = (
  tracer: Tracer,
  name: string,
  attributes?: TraceAttributes,
): TraceSpan => {
  const span = tracer.startSpan(name, { attributes }, ROOT_CONTEXT);
  return new OtelSpan(tracer, span);
};
