import type {
  ReadableSpan,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { spans } from "../store/schema.js";
import type { TraceDb } from "../store/sqlite.js";
import { toSpanRecord } from "./record.js";

type ExportResultCallback = Parameters<SpanExporter["export"]>[1];

export class SqliteSpanExporter implements SpanExporter {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly db: TraceDb) {}

  export(
    readableSpans: ReadableSpan[],
    resultCallback: ExportResultCallback,
  ): void {
    if (readableSpans.length === 0) {
      resultCallback({ code: 0 });
      return;
    }

    const rows = readableSpans.map((span) => {
      const record = toSpanRecord(span);
      return {
        sessionId: record.sessionId,
        serviceName: record.serviceName,
        traceId: record.traceId,
        spanId: record.spanId,
        parentSpanId: record.parentSpanId ?? null,
        name: record.name,
        startTime: record.startTime,
        endTime: record.endTime,
        attributes: JSON.stringify(record.attributes),
        events: JSON.stringify(record.events),
        statusCode: record.status.code,
        statusMessage: record.status.message ?? null,
      };
    });

    const write = this.pending.then(() =>
      this.db
        .insert(spans)
        .values(rows)
        .then(() => undefined),
    );
    this.pending = write.then(
      () => undefined,
      () => undefined,
    );
    write.then(
      () => resultCallback({ code: 0 }),
      (error: unknown) =>
        resultCallback({
          code: 1,
          error:
            error instanceof Error ? error : new Error(String(error)),
        }),
    );
  }

  async shutdown(): Promise<void> {
    await this.pending;
  }
}
