import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import type { HrTime } from "@opentelemetry/api";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { SpanRecord } from "../store/record.js";

const hrTimeToIsoString = (time: HrTime): string => {
  const [seconds, nanoseconds] = time;
  return new Date(seconds * 1000 + nanoseconds / 1e6).toISOString();
};

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

const toSpanRecord = (span: ReadableSpan): SpanRecord => {
  const context = span.spanContext();
  return {
    sessionId: asString(span.resource.attributes["session.id"]),
    serviceName: asString(span.resource.attributes["service.name"]),
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    name: span.name,
    startTime: hrTimeToIsoString(span.startTime),
    endTime: hrTimeToIsoString(span.endTime),
    attributes: span.attributes as SpanRecord["attributes"],
    events: span.events.map((event) => ({
      name: event.name,
      time: hrTimeToIsoString(event.time),
      attributes: event.attributes as SpanRecord["attributes"] | undefined,
    })),
    status: {
      code: span.status.code,
      message: span.status.message,
    },
  };
};

type ExportResultCallback = Parameters<SpanExporter["export"]>[1];

export class JsonlSpanExporter implements SpanExporter {
  private pending: Promise<void>;

  constructor(private readonly path: string) {
    this.pending = fs.mkdir(dirname(path), { recursive: true }).then(() => undefined);
  }

  export(spans: ReadableSpan[], resultCallback: ExportResultCallback): void {
    const lines = spans.map((span) => `${JSON.stringify(toSpanRecord(span))}\n`).join("");
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
