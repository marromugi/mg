import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { GenAiMappingExporter } from "./genai-exporter.js";

export const createOtlpExporter = (url: string): SpanExporter =>
  new GenAiMappingExporter(new OTLPTraceExporter({ url }));
