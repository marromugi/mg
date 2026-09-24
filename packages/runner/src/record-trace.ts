import type { TraceSdkOptions } from "@mg/trace/otel";

type TraceExporter = NonNullable<TraceSdkOptions["exporters"]>[number];

export type RecordTraceOptions = Omit<TraceSdkOptions, "sessionId"> &
  (
    | { jsonlPath: string }
    | { sqlitePath: string }
    | { exporters: [TraceExporter, ...TraceExporter[]] }
  );
