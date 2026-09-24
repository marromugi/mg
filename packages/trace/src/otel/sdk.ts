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
import type {
  TraceShutdownFailure,
  TraceShutdownStep,
} from "./errors.js";
import { TraceShutdownError } from "./errors.js";
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

// Takes the export result's code as a plain number so a failed export
// (any code other than 0, ExportResultCode.SUCCESS) can be checked without
// comparing across the exporter interface's own enum type.
const isFailedExportCode = (code: number): boolean => code !== 0;

type WatchedFailure = { step: "flush" | "shutdown"; error: unknown };

// Wraps one exporter so every failure it produces after this point is kept
// under its own label, for TraceShutdownError to report by target and step.
// OpenTelemetry only ever surfaces these failures back through the values it
// throws while closing; unclaimed thrown values are attributed elsewhere.
class WatchedExporter implements SpanExporter {
  private readonly recorded: WatchedFailure[] = [];

  constructor(
    readonly target: string,
    private readonly inner: SpanExporter,
  ) {}

  export(
    spans: ReadableSpan[],
    resultCallback: ExportResultCallback,
  ): void {
    this.inner.export(spans, (result) => {
      if (!isFailedExportCode(result.code)) {
        resultCallback(result);
        return;
      }
      const error =
        result.error ??
        new Error(
          `${this.target} reported a failed export without an error`,
        );
      this.recorded.push({ step: "flush", error });
      resultCallback({ code: result.code, error });
    });
  }

  async forceFlush(): Promise<void> {
    try {
      await (this.inner.forceFlush?.() ?? Promise.resolve());
    } catch (error) {
      this.recorded.push({ step: "flush", error });
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.inner.shutdown();
    } catch (error) {
      this.recorded.push({ step: "shutdown", error });
      throw error;
    }
  }

  // Removes and returns, in recorded order, this exporter's own failures
  // found among the still-unclaimed values OpenTelemetry threw.
  claim(unclaimed: unknown[]): TraceShutdownFailure[] {
    const claimed: TraceShutdownFailure[] = [];
    for (const failure of this.recorded) {
      const index = unclaimed.indexOf(failure.error);
      if (index !== -1) {
        unclaimed.splice(index, 1);
        claimed.push({
          target: this.target,
          step: failure.step,
          error: failure.error,
        });
      }
    }
    return claimed;
  }
}

export const createTraceSdk = async (
  options: TraceSdkOptions = {},
): Promise<TraceSdk> => {
  const watchedExporters: WatchedExporter[] = [];
  let sqliteDb: TraceDb | undefined;

  if (options.sqlitePath !== undefined) {
    if (options.sqlitePath === ":memory:") {
      throw new RangeError(
        'sqlitePath cannot be ":memory:": each connection gets its own database, so nothing written through the SDK could ever be read back',
      );
    }
    sqliteDb = await openTraceDb(options.sqlitePath);
    watchedExporters.push(
      new WatchedExporter("sqlite", new SqliteSpanExporter(sqliteDb)),
    );
  }
  if (options.jsonlPath !== undefined) {
    watchedExporters.push(
      new WatchedExporter(
        "jsonl",
        new JsonlSpanExporter(options.jsonlPath),
      ),
    );
  }
  if (options.exporters !== undefined) {
    options.exporters.forEach((exporter, index) => {
      watchedExporters.push(
        new WatchedExporter(
          `exporters[${index}]`,
          new NonClosingExporter(exporter),
        ),
      );
    });
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
    spanProcessors: watchedExporters.map(
      (exporter) => new SimpleSpanProcessor(exporter),
    ),
    sampler: new AlwaysOnSampler(),
    spanLimits,
    generalLimits,
  });

  // Runs one closing step, translating whatever OpenTelemetry throws into
  // TraceShutdownFailure entries: each watched exporter's own recorded
  // failures first, in exporter order, then any value none of them claimed.
  const runClosingStep = async (
    step: TraceShutdownStep,
    action: () => Promise<void>,
  ): Promise<TraceShutdownFailure[] | undefined> => {
    try {
      await action();
      return undefined;
    } catch (thrown) {
      const unclaimed: unknown[] = Array.isArray(thrown)
        ? [...thrown]
        : [thrown];
      const failures: TraceShutdownFailure[] = [];
      for (const exporter of watchedExporters) {
        failures.push(...exporter.claim(unclaimed));
      }
      for (const error of unclaimed) {
        failures.push({ target: "trace", step, error });
      }
      return failures;
    }
  };

  return {
    tracer: provider.getTracer(serviceName),
    sessionId,
    shutdown: async () => {
      const flushFailures = await runClosingStep("flush", () =>
        provider.forceFlush(),
      );
      if (flushFailures !== undefined) {
        throw new TraceShutdownError(flushFailures);
      }

      const shutdownFailures = await runClosingStep("shutdown", () =>
        provider.shutdown(),
      );
      if (shutdownFailures !== undefined) {
        throw new TraceShutdownError(shutdownFailures);
      }

      if (sqliteDb !== undefined) {
        try {
          sqliteDb.$client.close();
        } catch (error) {
          throw new TraceShutdownError([
            { target: "sqlite", step: "close", error },
          ]);
        }
      }
    },
  };
};
