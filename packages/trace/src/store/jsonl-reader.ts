import { promises as fs } from "node:fs";
import type { SessionSummary, TraceReader } from "./reader.js";
import type { SpanRecord } from "./record.js";
import { buildSessionTree } from "./tree.js";
import type { SessionTree } from "./tree.js";

export class JsonlTraceReader implements TraceReader {
  constructor(private readonly path: string) {}

  private async readRecords(): Promise<SpanRecord[]> {
    const content = await fs.readFile(this.path, "utf8");
    const records: SpanRecord[] = [];

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") {
        continue;
      }
      try {
        records.push(JSON.parse(trimmed) as SpanRecord);
      } catch {
        continue;
      }
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

    const summaries = Array.from(recordsBySessionId.entries()).map(
      ([sessionId, sessionRecords]): SessionSummary => {
        const traceIds = new Set(sessionRecords.map((record) => record.traceId));
        const startTime = sessionRecords.reduce(
          (earliest, record) => (record.startTime < earliest ? record.startTime : earliest),
          sessionRecords[0].startTime,
        );
        const endTime = sessionRecords.reduce(
          (latest, record) => (record.endTime > latest ? record.endTime : latest),
          sessionRecords[0].endTime,
        );
        return {
          sessionId,
          serviceName: sessionRecords[0].serviceName,
          startTime,
          endTime,
          traceCount: traceIds.size,
        };
      },
    );

    return summaries.sort((a, b) => b.startTime.localeCompare(a.startTime));
  }

  async readSession(sessionId: string): Promise<SessionTree | undefined> {
    const records = await this.readRecords();
    return buildSessionTree(records.filter((record) => record.sessionId === sessionId));
  }
}
