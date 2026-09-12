import { promises as fs } from "node:fs";
import type { SessionSummary, TraceReader } from "./reader.js";
import type { SpanRecord } from "./record.js";
import { buildSessionTree } from "./tree.js";
import type { SessionTree } from "./tree.js";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSpanRecordShape = (value: unknown): value is SpanRecord =>
  isPlainObject(value) &&
  typeof value.sessionId === "string" &&
  typeof value.serviceName === "string" &&
  typeof value.traceId === "string" &&
  typeof value.spanId === "string" &&
  typeof value.name === "string" &&
  typeof value.startTime === "string" &&
  typeof value.endTime === "string" &&
  isPlainObject(value.attributes) &&
  Array.isArray(value.events) &&
  isPlainObject(value.status);

export class JsonlTraceReader implements TraceReader {
  constructor(private readonly path: string) {}

  private async readRecords(): Promise<SpanRecord[]> {
    let content: string;
    try {
      content = await fs.readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const records: SpanRecord[] = [];

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!isSpanRecordShape(parsed)) {
        continue;
      }
      records.push(parsed);
    }

    return records;
  }

  async listSessions(): Promise<SessionSummary[]> {
    const records = await this.readRecords();
    const recordsBySessionId = new Map<string, SpanRecord[]>();

    for (const record of records) {
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
    const records = await this.readRecords();
    return buildSessionTree(records.filter((record) => record.sessionId === sessionId));
  }
}
