import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { spans } from "../store/schema.js";
import type { TraceDb } from "../store/sqlite.js";
import { toSpanRecord } from "./record.js";

type ExportResultCallback = Parameters<SpanExporter["export"]>[1];

export class SqliteSpanExporter implements SpanExporter {
  private pending: Promise<void>;

  constructor(private readonly db: TraceDb | Promise<TraceDb>) {
    this.pending = Promise.resolve();
  }

  export(readableSpans: ReadableSpan[], resultCallback: ExportResultCallback): void {
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

    const write = this.pending.then(async () => {
      const db = await this.db;
      await db.insert(spans).values(rows);
    });
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
    const db = await this.db;
    await db.$client.close();
  }
}
