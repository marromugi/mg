import { desc, eq, max, min, sql } from "drizzle-orm";
import type { SessionSummary, TraceReader } from "./reader.js";
import type { SpanRecord } from "./record.js";
import { spans } from "./schema.js";
import type { TraceDb } from "./sqlite.js";
import { buildSessionTree } from "./tree.js";
import type { SessionTree } from "./tree.js";

const toSpanRecord = (row: typeof spans.$inferSelect): SpanRecord => ({
  sessionId: row.sessionId,
  serviceName: row.serviceName,
  traceId: row.traceId,
  spanId: row.spanId,
  parentSpanId: row.parentSpanId ?? undefined,
  name: row.name,
  startTime: row.startTime,
  endTime: row.endTime,
  attributes: JSON.parse(row.attributes) as SpanRecord["attributes"],
  events: JSON.parse(row.events) as SpanRecord["events"],
  status: {
    code: row.statusCode,
    message: row.statusMessage ?? undefined,
  },
});

export class SqliteTraceReader implements TraceReader {
  constructor(private readonly db: TraceDb) {}

  async listSessions(): Promise<SessionSummary[]> {
    const rows = await this.db
      .select({
        sessionId: spans.sessionId,
        serviceName: min(spans.serviceName),
        startTime: min(spans.startTime),
        endTime: max(spans.endTime),
        traceCount: sql<number>`count(*) filter (where parent_span_id is null or not exists (select 1 from spans p where p.session_id = spans.session_id and p.span_id = spans.parent_span_id))`,
      })
      .from(spans)
      .groupBy(spans.sessionId)
      .orderBy(desc(min(spans.startTime)));

    return rows.map((row) => ({
      sessionId: row.sessionId,
      serviceName: row.serviceName ?? "",
      startTime: row.startTime ?? "",
      endTime: row.endTime ?? "",
      traceCount: row.traceCount,
    }));
  }

  async readSession(
    sessionId: string,
  ): Promise<SessionTree | undefined> {
    const rows = await this.db
      .select()
      .from(spans)
      .where(eq(spans.sessionId, sessionId));
    return buildSessionTree(rows.map(toSpanRecord));
  }
}
