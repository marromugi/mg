export type SpanRecord = {
  sessionId: string;
  serviceName: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: string;
  endTime: string;
  attributes: Record<string, string | number | boolean | (string | number | boolean)[]>;
  events: { name: string; time: string; attributes?: SpanRecord["attributes"] }[];
  status: { code: number; message?: string };
};
