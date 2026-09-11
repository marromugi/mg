import type { Tracer } from "@opentelemetry/api";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { JsonlSpanExporter } from "./jsonl-exporter.js";

export type TraceSdkOptions = {
  jsonlPath?: string;
  exporters?: SpanExporter[];
  serviceName?: string;
};

export type TraceSdk = {
  tracer: Tracer;
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

  const provider = new BasicTracerProvider({
    spanProcessors: exporters.map((exporter) => new SimpleSpanProcessor(exporter)),
  });

  return {
    tracer: provider.getTracer(options.serviceName ?? "mg"),
    shutdown: async () => {
      await provider.forceFlush();
      await provider.shutdown();
    },
  };
};
