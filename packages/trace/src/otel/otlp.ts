import { OTLPExporterBase } from "@opentelemetry/otlp-exporter-base";
import {
  createOtlpHttpExportDelegate,
  httpAgentFactoryFromOptions,
} from "@opentelemetry/otlp-exporter-base/node-http";
import {
  JsonTraceSerializer,
  TraceExporterMetricsHelper,
} from "@opentelemetry/otlp-transformer";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { GenAiMappingExporter } from "./genai-exporter.js";

export type OtlpExporterOptions = {
  url: string;
  headers?: Readonly<Record<string, string>>;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 2147483647;
const RESERVED_HEADERS = ["content-type", "user-agent"];

const assertUrl = (url: string): void => {
  const refuse = (): never => {
    throw new RangeError(
      `url must be an absolute http or https URL, got: ${url}`,
    );
  };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return refuse();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    refuse();
  }
};

const assertTimeout = (timeoutMs: number): void => {
  if (!(timeoutMs > 0 && timeoutMs <= MAX_TIMEOUT_MS)) {
    throw new RangeError(
      `timeoutMs must be greater than 0 and at most ${MAX_TIMEOUT_MS} milliseconds, got: ${String(timeoutMs)}`,
    );
  }
};

const assertHeaders = (
  headers: Readonly<Record<string, string>>,
): void => {
  const names = Object.keys(headers);
  for (const name of names) {
    if (RESERVED_HEADERS.includes(name.toLowerCase())) {
      throw new RangeError(
        `headers must not include ${name}: the exporter sets it itself`,
      );
    }
  }
  const seen = new Map<string, string>();
  for (const name of names) {
    const first = seen.get(name.toLowerCase());
    if (first !== undefined) {
      throw new RangeError(
        `headers ${first} and ${name} differ only in case, and header names ignore case`,
      );
    }
    seen.set(name.toLowerCase(), name);
  }
};

export const createOtlpExporter = (
  options: OtlpExporterOptions,
): SpanExporter => {
  const { url, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  assertUrl(url);
  assertTimeout(timeoutMs);
  assertHeaders(headers);

  const delegate = createOtlpHttpExportDelegate(
    {
      url,
      headers: async () => ({
        ...headers,
        "Content-Type": "application/json",
      }),
      timeoutMillis: timeoutMs,
      compression: "none",
      concurrencyLimit: 30,
      agentFactory: httpAgentFactoryFromOptions({ keepAlive: true }),
    },
    JsonTraceSerializer,
    // Matches the component type OpenTelemetry's own trace exporter reports.
    "otlp_http_span_exporter",
    TraceExporterMetricsHelper,
    undefined,
  );
  return new GenAiMappingExporter(new OTLPExporterBase(delegate));
};
