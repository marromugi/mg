import type { Tracer } from "@opentelemetry/api";
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import {
  AlwaysOnSampler,
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type {
  ReadableSpan,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { nanoid } from "nanoid";
import type { TraceDb } from "../store/sqlite.js";
import { openTraceDb } from "../store/sqlite.js";
import { JsonlSpanExporter } from "./jsonl-exporter.js";
import { generalLimits, spanLimits } from "./limits.js";
import { SqliteSpanExporter } from "./sqlite-exporter.js";

const ATTR_SESSION_ID = "session.id";
const ATTR_SERVICE_NAME = "service.name";

export type TraceSdkOptions = {
  jsonlPath?: string;
  sqlitePath?: string;
  exporters?: SpanExporter[];
  serviceName?: string;
  sessionId?: string;
};

export type TraceSdk = {
  tracer: Tracer;
  sessionId: string;
  shutdown: () => Promise<void>;
};

type ExportResultCallback = Parameters<SpanExporter["export"]>[1];

// Externally provided exporters were not opened by this SDK, so shutdown
// must not close them; export and forceFlush still delegate.
class NonClosingExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(
    spans: ReadableSpan[],
    resultCallback: ExportResultCallback,
  ): void {
    this.inner.export(spans, resultCallback);
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

export const createTraceSdk = async (
  options: TraceSdkOptions = {},
): Promise<TraceSdk> => {
  const exporters: SpanExporter[] = [];
  let sqliteDb: TraceDb | undefined;

  if (options.sqlitePath !== undefined) {
    if (options.sqlitePath === ":memory:") {
      throw new RangeError(
        'sqlitePath cannot be ":memory:": each connection gets its own database, so nothing written through the SDK could ever be read back',
      );
    }
    sqliteDb = await openTraceDb(options.sqlitePath);
    exporters.push(new SqliteSpanExporter(sqliteDb));
  }
  if (options.jsonlPath !== undefined) {
    exporters.push(new JsonlSpanExporter(options.jsonlPath));
  }
  if (options.exporters !== undefined) {
    exporters.push(
      ...options.exporters.map(
        (exporter) => new NonClosingExporter(exporter),
      ),
    );
  }

  const serviceName = options.serviceName ?? "mg";
  const sessionId = options.sessionId ?? nanoid();

  const provider = new BasicTracerProvider({
    resource: defaultResource().merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
        [ATTR_SESSION_ID]: sessionId,
      }),
    ),
    spanProcessors: exporters.map(
      (exporter) => new SimpleSpanProcessor(exporter),
    ),
    sampler: new AlwaysOnSampler(),
    spanLimits,
    generalLimits,
  });

  return {
    tracer: provider.getTracer(serviceName),
    sessionId,
    shutdown: async () => {
      await provider.forceFlush();
      await provider.shutdown();
      if (sqliteDb !== undefined) {
        sqliteDb.$client.close();
      }
    },
  };
};
