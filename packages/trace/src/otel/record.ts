import type { HrTime } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { SpanRecord } from "../store/record.js";

export const hrTimeToIsoString = (time: HrTime): string => {
  const [seconds, nanoseconds] = time;
  return new Date(seconds * 1000 + nanoseconds / 1e6).toISOString();
};

export const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

export const toSpanRecord = (span: ReadableSpan): SpanRecord => {
  const context = span.spanContext();
  return {
    sessionId: asString(span.resource.attributes["session.id"]),
    serviceName: asString(span.resource.attributes["service.name"]),
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    name: span.name,
    startTime: hrTimeToIsoString(span.startTime),
    endTime: hrTimeToIsoString(span.endTime),
    attributes: span.attributes as SpanRecord["attributes"],
    events: span.events.map((event) => ({
      name: event.name,
      time: hrTimeToIsoString(event.time),
      attributes: event.attributes as SpanRecord["attributes"] | undefined,
    })),
    status: {
      code: span.status.code,
      message: span.status.message,
    },
  };
};
