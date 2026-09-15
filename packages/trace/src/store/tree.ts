import type { SpanRecord } from "./record.js";

export type SpanNode = Omit<SpanRecord, "parentSpanId"> & {
  children: SpanNode[];
};

export type TraceTree = { traceId: string; root: SpanNode };

export type SessionTree = {
  sessionId: string;
  serviceName: string;
  startTime: string;
  endTime: string;
  traces: TraceTree[];
};

const byStartTime = (
  a: { startTime: string },
  b: { startTime: string },
): number => a.startTime.localeCompare(b.startTime);

const toNode = (
  record: SpanRecord,
  childrenByParentId: Map<string, SpanRecord[]>,
): SpanNode => {
  const { parentSpanId: _parentSpanId, ...rest } = record;
  const children = (childrenByParentId.get(record.spanId) ?? [])
    .map((child) => toNode(child, childrenByParentId))
    .sort(byStartTime);
  return { ...rest, children };
};

const buildTraceTrees = (
  traceId: string,
  records: SpanRecord[],
): TraceTree[] => {
  const spanIds = new Set(records.map((record) => record.spanId));
  const childrenByParentId = new Map<string, SpanRecord[]>();
  const roots: SpanRecord[] = [];

  for (const record of records) {
    if (
      record.parentSpanId !== undefined &&
      spanIds.has(record.parentSpanId)
    ) {
      const siblings = childrenByParentId.get(record.parentSpanId);
      if (siblings) {
        siblings.push(record);
      } else {
        childrenByParentId.set(record.parentSpanId, [record]);
      }
    } else {
      roots.push(record);
    }
  }

  return roots.map((root) => ({
    traceId,
    root: toNode(root, childrenByParentId),
  }));
};

export const buildSessionTree = (
  records: SpanRecord[],
): SessionTree | undefined => {
  if (records.length === 0) {
    return undefined;
  }

  const recordsByTraceId = new Map<string, SpanRecord[]>();
  for (const record of records) {
    const siblings = recordsByTraceId.get(record.traceId);
    if (siblings) {
      siblings.push(record);
    } else {
      recordsByTraceId.set(record.traceId, [record]);
    }
  }

  const traces = Array.from(recordsByTraceId.entries())
    .flatMap(([traceId, traceRecords]) =>
      buildTraceTrees(traceId, traceRecords),
    )
    .sort((a, b) => byStartTime(a.root, b.root));

  const startTime = records.reduce(
    (earliest, record) =>
      record.startTime < earliest ? record.startTime : earliest,
    records[0].startTime,
  );
  const endTime = records.reduce(
    (latest, record) =>
      record.endTime > latest ? record.endTime : latest,
    records[0].endTime,
  );

  return {
    sessionId: records[0].sessionId,
    serviceName: records[0].serviceName,
    startTime,
    endTime,
    traces,
  };
};
