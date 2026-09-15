import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const spans = sqliteTable(
  "spans",
  {
    sessionId: text("session_id").notNull(),
    serviceName: text("service_name").notNull(),
    traceId: text("trace_id").notNull(),
    spanId: text("span_id").primaryKey(),
    parentSpanId: text("parent_span_id"),
    name: text("name").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    attributes: text("attributes").notNull(),
    events: text("events").notNull(),
    statusCode: integer("status_code").notNull(),
    statusMessage: text("status_message"),
  },
  (table) => [
    index("spans_session_id_idx").on(table.sessionId),
    index("spans_trace_id_idx").on(table.traceId),
  ],
);
