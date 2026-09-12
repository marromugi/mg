import type { SessionTree } from "./tree.js";

export type SessionSummary = {
  sessionId: string;
  serviceName: string;
  startTime: string;
  endTime: string;
  traceCount: number;
};

export interface TraceReader {
  listSessions(): Promise<SessionSummary[]>;
  readSession(sessionId: string): Promise<SessionTree | undefined>;
}
