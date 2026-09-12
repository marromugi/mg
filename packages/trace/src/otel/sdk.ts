import type { Tracer } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { nanoid } from "nanoid";
import { JsonlSpanExporter } from "./jsonl-exporter.js";

const ATTR_SESSION_ID = "session.id";
const ATTR_SERVICE_NAME = "service.name";

export type TraceSdkOptions = {
  jsonlPath?: string;
  exporters?: SpanExporter[];
  serviceName?: string;
  sessionId?: string;
};

export type TraceSdk = {
  tracer: Tracer;
  sessionId: string;
  shutdown: () => Promise<void>;
};

export const createTraceSdk = (options: TraceSdkOptions = {}): TraceSdk => {
  const exporters: SpanExporter[] = [];
  if (options.jsonlPath !== undefined) {
    exporters.push(new JsonlSpanExporter(options.jsonlPath));
  }
  if (options.exporters !== undefined) {
    exporters.push(...options.exporters);
  }

  const serviceName = options.serviceName ?? "mg";
  const sessionId = options.sessionId ?? nanoid();

  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SESSION_ID]: sessionId,
    }),
    spanProcessors: exporters.map((exporter) => new SimpleSpanProcessor(exporter)),
  });

  return {
    tracer: provider.getTracer(serviceName),
    sessionId,
    shutdown: async () => {
      await provider.forceFlush();
      await provider.shutdown();
    },
  };
};
