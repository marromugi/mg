import { eq } from "drizzle-orm";
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
  status: { code: row.statusCode, message: row.statusMessage ?? undefined },
});

export class SqliteTraceReader implements TraceReader {
  constructor(private readonly db: TraceDb) {}

  async listSessions(): Promise<SessionSummary[]> {
    const rows = await this.db.select().from(spans);
    const recordsBySessionId = new Map<string, SpanRecord[]>();

    for (const row of rows) {
      const record = toSpanRecord(row);
      const siblings = recordsBySessionId.get(record.sessionId);
      if (siblings) {
        siblings.push(record);
      } else {
        recordsBySessionId.set(record.sessionId, [record]);
      }
    }

    const summaries: SessionSummary[] = [];
    for (const [sessionId, sessionRecords] of recordsBySessionId) {
      const tree = buildSessionTree(sessionRecords);
      if (tree === undefined) {
        continue;
      }
      summaries.push({
        sessionId,
        serviceName: tree.serviceName,
        startTime: tree.startTime,
        endTime: tree.endTime,
        traceCount: tree.traces.length,
      });
    }

    return summaries.sort((a, b) => b.startTime.localeCompare(a.startTime));
  }

  async readSession(sessionId: string): Promise<SessionTree | undefined> {
    const rows = await this.db.select().from(spans).where(eq(spans.sessionId, sessionId));
    return buildSessionTree(rows.map(toSpanRecord));
  }
}
