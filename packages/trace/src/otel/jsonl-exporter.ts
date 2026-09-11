import { promises as fs } from "node:fs";
import type { Attributes, HrTime } from "@opentelemetry/api";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

const hrTimeToIsoString = (time: HrTime): string => {
  const [seconds, nanoseconds] = time;
  return new Date(seconds * 1000 + nanoseconds / 1e6).toISOString();
};

type JsonlSpanEvent = {
  name: string;
  time: string;
  attributes?: Attributes;
};

type JsonlSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: string;
  endTime: string;
  attributes: Attributes;
  events: JsonlSpanEvent[];
  status: { code: number; message?: string };
};

const toJsonlSpan = (span: ReadableSpan): JsonlSpan => {
  const context = span.spanContext();
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    name: span.name,
    startTime: hrTimeToIsoString(span.startTime),
    endTime: hrTimeToIsoString(span.endTime),
    attributes: span.attributes,
    events: span.events.map((event) => ({
      name: event.name,
      time: hrTimeToIsoString(event.time),
      attributes: event.attributes,
    })),
    status: {
      code: span.status.code,
      message: span.status.message,
    },
  };
};

type ExportResultCallback = Parameters<SpanExporter["export"]>[1];

export class JsonlSpanExporter implements SpanExporter {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  export(spans: ReadableSpan[], resultCallback: ExportResultCallback): void {
    const lines = spans.map((span) => `${JSON.stringify(toJsonlSpan(span))}\n`).join("");
    const write = this.pending.then(() => fs.appendFile(this.path, lines));
    this.pending = write.then(
      () => undefined,
      () => undefined,
    );
    write.then(
      () => resultCallback({ code: 0 }),
      (error: unknown) =>
        resultCallback({
          code: 1,
          error: error instanceof Error ? error : new Error(String(error)),
        }),
    );
  }

  async shutdown(): Promise<void> {
    await this.pending;
  }
}
