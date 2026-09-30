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
import type { TraceShutdownFailure } from "./errors.js";
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

type WatchedStep = "flush" | "shutdown";

type WatchedFailure = {
  step: WatchedStep;
  error: unknown;
  afterClosingStarted: boolean;
};

// Wraps one exporter so every failure it produces, before and after closing
// starts, is kept under its own label, for TraceShutdownError to report by
// target and step. A failure recorded after closing started is always part
// of the outcome, under the step the closing sequence was running; one
// recorded earlier is included only when OpenTelemetry rethrows that same
// value while closing. Unclaimed thrown values are attributed elsewhere.
class WatchedExporter implements SpanExporter {
  private readonly recorded: WatchedFailure[] = [];
  private runningStep: WatchedStep | undefined;
  private pendingSpans = 0;
  private shutdownCall: Promise<void> | undefined;

  constructor(
    readonly target: string,
    private readonly inner: SpanExporter,
  ) {}

  startStep(step: WatchedStep): void {
    this.runningStep = step;
  }

  export(
    spans: ReadableSpan[],
    resultCallback: ExportResultCallback,
  ): void {
    this.pendingSpans += spans.length;
    this.inner.export(spans, (result) => {
      this.pendingSpans -= spans.length;
      if (!isFailedExportCode(result.code)) {
        resultCallback(result);
        return;
      }
      const error =
        result.error ??
        new Error(
          `${this.target} reported a failed export without an error`,
        );
      this.record(error);
      resultCallback({ code: result.code, error });
    });
  }

  async forceFlush(): Promise<void> {
    try {
      await (this.inner.forceFlush?.() ?? Promise.resolve());
    } catch (error) {
      this.record(error);
      throw error;
    }
  }

  shutdown(): Promise<void> {
    this.shutdownCall = this.closeInner();
    return this.shutdownCall;
  }

  private async closeInner(): Promise<void> {
    try {
      await this.inner.shutdown();
    } catch (error) {
      this.record(error);
      throw error;
    }
  }

  // Resolves once this exporter's own shutdown call has settled, however it
  // settled. Resolves at once when shutdown was never called.
  async shutdownSettled(): Promise<void> {
    try {
      await this.shutdownCall;
    } catch {
      // Already recorded by closeInner.
    }
  }

  private record(error: unknown): void {
    this.recorded.push({
      step: this.runningStep ?? "flush",
      error,
      afterClosingStarted: this.runningStep !== undefined,
    });
  }

  // Returns, in recorded order, this exporter's own failures for the given
  // step: every one recorded after closing started, plus any recorded
  // earlier that OpenTelemetry rethrew, then, for the shutdown step, the
  // exports still without a result. Claimed values are removed from
  // `unclaimed` so they are not also attributed to "trace".
  collect(
    step: WatchedStep,
    unclaimed: unknown[],
  ): TraceShutdownFailure[] {
    const collected: TraceShutdownFailure[] = [];
    for (const failure of this.recorded) {
      if (failure.step !== step) continue;
      const index = unclaimed.indexOf(failure.error);
      if (index !== -1) {
        unclaimed.splice(index, 1);
      }
      if (failure.afterClosingStarted || index !== -1) {
        collected.push({
          target: this.target,
          step,
          error: failure.error,
        });
      }
    }
    if (step === "shutdown" && this.pendingSpans > 0) {
      collected.push({
        target: this.target,
        step,
        error: new Error(
          `${this.target} had ${this.pendingSpans} span(s) still being exported when closing finished`,
        ),
      });
    }
    return collected;
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

  // Runs one closing step, translating whatever OpenTelemetry throws (if
  // anything) into TraceShutdownFailure entries: each watched exporter's own
  // failures for this step, in exporter order, then any thrown value none of
  // them claimed. OpenTelemetry may surface only one of several exporters'
  // failures, so the watchers' records are the source.
  const runClosingStep = async (
    step: WatchedStep,
    action: () => Promise<void>,
  ): Promise<TraceShutdownFailure[]> => {
    for (const exporter of watchedExporters) {
      exporter.startStep(step);
    }
    const unclaimed: unknown[] = [];
    try {
      await action();
    } catch (thrown) {
      unclaimed.push(...(Array.isArray(thrown) ? thrown : [thrown]));
    }

    const failures: TraceShutdownFailure[] = [];
    for (const exporter of watchedExporters) {
      failures.push(...exporter.collect(step, unclaimed));
    }
    for (const error of unclaimed) {
      failures.push({ target: "trace", step, error });
    }
    return failures;
  };

  // OpenTelemetry starts every exporter's shutdown before it settles, but
  // rejects on the first failure without waiting for the rest, so each
  // exporter's own shutdown is awaited here before SQLite is closed.
  const endOpenTelemetry = async (): Promise<void> => {
    try {
      await provider.shutdown();
    } finally {
      await Promise.all(
        watchedExporters.map((exporter) => exporter.shutdownSettled()),
      );
    }
  };

  return {
    tracer: provider.getTracer(serviceName),
    sessionId,
    shutdown: async () => {
      const failures: TraceShutdownFailure[] = [];
      failures.push(
        ...(await runClosingStep("flush", () => provider.forceFlush())),
      );
      failures.push(
        ...(await runClosingStep("shutdown", endOpenTelemetry)),
      );
      if (sqliteDb !== undefined) {
        try {
          sqliteDb.$client.close();
        } catch (error) {
          failures.push({ target: "sqlite", step: "close", error });
        }
      }
      if (failures.length > 0) {
        throw new TraceShutdownError(failures);
      }
    },
  };
};
