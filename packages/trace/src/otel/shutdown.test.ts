import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import type {
  ReadableSpan,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { startRootSpan } from "../otel-span.js";
import { TraceShutdownError } from "./errors.js";
import { createTraceSdk } from "./sdk.js";

type ExportResultCallback = Parameters<SpanExporter["export"]>[1];

// A destination that succeeds every call.
class SucceedingExporter implements SpanExporter {
  export(
    _spans: ReadableSpan[],
    resultCallback: ExportResultCallback,
  ): void {
    resultCallback({ code: 0 });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

// A destination that rejects forceFlush with the given value.
class FlushRejectingExporter implements SpanExporter {
  constructor(private readonly value: unknown) {}

  export(
    _spans: ReadableSpan[],
    resultCallback: ExportResultCallback,
  ): void {
    resultCallback({ code: 0 });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.reject(this.value);
  }
}

class StuckForceFlushExporter implements SpanExporter {
  export(
    _spans: ReadableSpan[],
    resultCallback: ExportResultCallback,
  ): void {
    resultCallback({ code: 0 });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return new Promise(() => {
      // Never settles.
    });
  }
}

class DelayedFailureWithoutErrorExporter implements SpanExporter {
  export(
    _spans: ReadableSpan[],
    resultCallback: ExportResultCallback,
  ): void {
    setTimeout(() => resultCallback({ code: 1 }), 10);
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

class ImmediateFailureWithErrorExporter implements SpanExporter {
  constructor(private readonly error: Error) {}

  export(
    _spans: ReadableSpan[],
    resultCallback: ExportResultCallback,
  ): void {
    resultCallback({ code: 1, error: this.error });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

const endOneSpan = (
  sdk: Awaited<ReturnType<typeof createTraceSdk>>,
) => {
  startRootSpan(sdk.tracer, "root").end();
};

describe("createTraceSdk's shutdown failures", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mg-trace-shutdown-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects with a TraceShutdownError naming the failing destination, the flush step, and its error", async () => {
    const error = new Error("disk");
    const sdk = await createTraceSdk({
      exporters: [new FlushRejectingExporter(error)],
    });
    endOneSpan(sdk);

    let caught: unknown;
    try {
      await sdk.shutdown();
    } catch (thrown) {
      caught = thrown;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as TraceShutdownError).name).toBe(
      "TraceShutdownError",
    );
    expect((caught as TraceShutdownError).failures).toEqual([
      { target: "exporters[0]", step: "flush", error },
    ]);
    expect((caught as TraceShutdownError).errors).toEqual([error]);
    expect((caught as Error).message).toBe(
      "Closing the trace record failed for 1 target: exporters[0] (flush): disk",
    );
  });

  it("lists each failing destination in order when several fail to flush", async () => {
    const errorA = new Error("a");
    const sdk = await createTraceSdk({
      exporters: [
        new SucceedingExporter(),
        new FlushRejectingExporter(errorA),
        new FlushRejectingExporter("b"),
      ],
    });
    endOneSpan(sdk);

    let caught: unknown;
    try {
      await sdk.shutdown();
    } catch (thrown) {
      caught = thrown;
    }

    expect((caught as TraceShutdownError).failures).toEqual([
      { target: "exporters[1]", step: "flush", error: errorA },
      { target: "exporters[2]", step: "flush", error: "b" },
    ]);
    expect((caught as TraceShutdownError).errors).toEqual([
      errorA,
      "b",
    ]);
    expect((caught as Error).message).toBe(
      "Closing the trace record failed for 2 targets: exporters[1] (flush): a; exporters[2] (flush): b",
    );
  });

  it("names the jsonl destination when writing to it fails", async () => {
    const jsonlPath = join(dir, "spans.jsonl");
    mkdirSync(jsonlPath);
    const sdk = await createTraceSdk({ jsonlPath });
    endOneSpan(sdk);

    let caught: unknown;
    try {
      await sdk.shutdown();
    } catch (thrown) {
      caught = thrown;
    }

    const failures = (caught as TraceShutdownError).failures;
    expect(failures).toHaveLength(1);
    const [failure] = failures;
    if (failure === undefined) throw new Error("expected a failure");
    expect(failure.target).toBe("jsonl");
    expect(failure.step).toBe("flush");
    expect((failure.error as { code: unknown }).code).toBe("EISDIR");
  });

  it("names the failure as trace's own when OpenTelemetry's flush times out", async () => {
    vi.useFakeTimers();
    try {
      const sdk = await createTraceSdk({
        exporters: [new StuckForceFlushExporter()],
      });
      endOneSpan(sdk);

      let caught: unknown;
      const settled = sdk.shutdown().catch((thrown: unknown) => {
        caught = thrown;
      });
      await vi.advanceTimersByTimeAsync(30000);
      await settled;

      const failures = (caught as TraceShutdownError).failures;
      expect(failures).toHaveLength(1);
      expect(failures[0]?.target).toBe("trace");
      expect(failures[0]?.step).toBe("flush");
      expect(failures[0]?.error).toBeInstanceOf(Error);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a destination's own error when it reports a failed export without one", async () => {
    const sdk = await createTraceSdk({
      exporters: [new DelayedFailureWithoutErrorExporter()],
    });
    endOneSpan(sdk);

    let caught: unknown;
    try {
      await sdk.shutdown();
    } catch (thrown) {
      caught = thrown;
    }

    expect((caught as TraceShutdownError).failures).toEqual([
      {
        target: "exporters[0]",
        step: "flush",
        error: expect.objectContaining({
          message:
            "exporters[0] reported a failed export without an error",
        }),
      },
    ]);
  });

  it("names the failure as trace's own when ending OpenTelemetry fails", async () => {
    const spy = vi
      .spyOn(BasicTracerProvider.prototype, "shutdown")
      .mockRejectedValueOnce(new Error("stuck"));
    try {
      const sdk = await createTraceSdk();
      endOneSpan(sdk);

      let caught: unknown;
      try {
        await sdk.shutdown();
      } catch (thrown) {
        caught = thrown;
      }

      expect((caught as TraceShutdownError).failures).toEqual([
        { target: "trace", step: "shutdown", error: expect.any(Error) },
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it("names the sqlite destination when closing its connection fails", async () => {
    const probe = createClient({ url: "file::memory:" });
    const prototype = Object.getPrototypeOf(probe) as {
      close: () => void;
    };
    const spy = vi
      .spyOn(prototype, "close")
      .mockImplementationOnce(() => {
        throw new Error("locked");
      });
    try {
      const sqlitePath = join(dir, "spans.db");
      const sdk = await createTraceSdk({ sqlitePath });
      endOneSpan(sdk);

      let caught: unknown;
      try {
        await sdk.shutdown();
      } catch (thrown) {
        caught = thrown;
      }

      expect((caught as TraceShutdownError).failures).toEqual([
        { target: "sqlite", step: "close", error: expect.any(Error) },
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it("wraps the failure even when a destination returns its result the moment export is called", async () => {
    const error = new Error("early");
    const sdk = await createTraceSdk({
      exporters: [new ImmediateFailureWithErrorExporter(error)],
    });
    endOneSpan(sdk);

    let caught: unknown;
    try {
      await sdk.shutdown();
    } catch (thrown) {
      caught = thrown;
    }

    expect((caught as TraceShutdownError).failures).toEqual([
      { target: "exporters[0]", step: "flush", error },
    ]);
  });
});

// A destination whose export never reports a result.
class NeverReportingExporter implements SpanExporter {
  export(): void {
    // Never calls its result callback.
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

const FLUSH_TIMEOUT_MESSAGE =
  "Span processor did not completed within timeout period of 30000 ms";

const failuresOf = async (
  sdk: Awaited<ReturnType<typeof createTraceSdk>>,
): Promise<TraceShutdownError["failures"]> => {
  try {
    await sdk.shutdown();
  } catch (thrown) {
    return (thrown as TraceShutdownError).failures;
  }
  throw new Error("expected shutdown to reject");
};

type ClientPrototype = {
  close: () => void;
  execute: (...args: unknown[]) => Promise<unknown>;
};

const clientPrototype = (): ClientPrototype =>
  Object.getPrototypeOf(
    createClient({ url: "file::memory:" }),
  ) as ClientPrototype;

// Ends OpenTelemetry the way it does when one processor rejects: every
// exporter's shutdown starts, then the combined promise rejects at once.
const rejectShutdownAfterStarting = (value: unknown) => {
  const original = BasicTracerProvider.prototype.shutdown;
  return vi
    .spyOn(BasicTracerProvider.prototype, "shutdown")
    .mockImplementation(function (this: BasicTracerProvider) {
      original.call(this).catch(() => undefined);
      return Promise.reject(value);
    });
};

describe("createTraceSdk's shutdown runs every closing step", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mg-trace-steps-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("lists a failed flush and a failed SQLite close together", async () => {
    const disk = new Error("disk");
    const locked = new Error("locked");
    vi.spyOn(clientPrototype(), "close").mockImplementationOnce(() => {
      throw locked;
    });
    const sdk = await createTraceSdk({
      sqlitePath: join(dir, "spans.db"),
      exporters: [new FlushRejectingExporter(disk)],
    });
    endOneSpan(sdk);

    let caught: unknown;
    try {
      await sdk.shutdown();
    } catch (thrown) {
      caught = thrown;
    }

    expect((caught as TraceShutdownError).failures).toEqual([
      { target: "exporters[0]", step: "flush", error: disk },
      { target: "sqlite", step: "close", error: locked },
    ]);
    expect((caught as Error).message).toBe(
      "Closing the trace record failed for 2 targets: exporters[0] (flush): disk; sqlite (close): locked",
    );
  });

  it("ends OpenTelemetry after a failed flush", async () => {
    const disk = new Error("disk");
    const stuck = new Error("stuck");
    rejectShutdownAfterStarting(stuck);
    const sdk = await createTraceSdk({
      exporters: [new FlushRejectingExporter(disk)],
    });
    endOneSpan(sdk);

    expect(await failuresOf(sdk)).toEqual([
      { target: "exporters[0]", step: "flush", error: disk },
      { target: "trace", step: "shutdown", error: stuck },
    ]);
  });

  it("closes SQLite after ending OpenTelemetry fails", async () => {
    const stuck = new Error("stuck");
    const locked = new Error("locked");
    vi.spyOn(clientPrototype(), "close").mockImplementationOnce(() => {
      throw locked;
    });
    rejectShutdownAfterStarting(stuck);
    const sdk = await createTraceSdk({
      sqlitePath: join(dir, "spans.db"),
    });
    endOneSpan(sdk);

    expect(await failuresOf(sdk)).toEqual([
      { target: "trace", step: "shutdown", error: stuck },
      { target: "sqlite", step: "close", error: locked },
    ]);
  });

  it("names a write that fails while OpenTelemetry is ending with the shutdown step", async () => {
    const busy = new Error("busy");
    const sdk = await createTraceSdk({
      sqlitePath: join(dir, "spans.db"),
    });
    vi.useFakeTimers();
    vi.spyOn(clientPrototype(), "execute").mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(busy), 40000);
        }),
    );
    endOneSpan(sdk);

    let failures: TraceShutdownError["failures"] = [];
    const settled = failuresOf(sdk).then((value) => {
      failures = value;
    });
    await vi.advanceTimersByTimeAsync(30000);
    await vi.advanceTimersByTimeAsync(10000);
    await settled;

    expect(failures).toEqual([
      {
        target: "trace",
        step: "flush",
        error: expect.objectContaining({
          message: FLUSH_TIMEOUT_MESSAGE,
        }),
      },
      {
        target: "sqlite",
        step: "shutdown",
        error: expect.objectContaining({ cause: busy }),
      },
    ]);
  });

  it("waits for a pending SQLite write before closing when ending OpenTelemetry rejects", async () => {
    const stuck = new Error("stuck");
    const sqlitePath = join(dir, "spans.db");
    const sdk = await createTraceSdk({ sqlitePath });
    vi.useFakeTimers();
    const prototype = clientPrototype();
    const originalExecute = prototype.execute;
    const originalClose = prototype.close;
    let closed = false;
    vi.spyOn(prototype, "execute").mockImplementation(function (
      this: unknown,
      ...args: unknown[]
    ) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (closed) {
            reject(new Error("CLIENT_CLOSED"));
            return;
          }
          resolve(originalExecute.apply(this, args));
        }, 40000);
      });
    });
    vi.spyOn(prototype, "close").mockImplementation(function (
      this: unknown,
    ) {
      closed = true;
      originalClose.call(this);
    });
    rejectShutdownAfterStarting(stuck);
    endOneSpan(sdk);

    let failures: TraceShutdownError["failures"] | undefined;
    const settled = failuresOf(sdk).then((value) => {
      failures = value;
    });
    await vi.advanceTimersByTimeAsync(39999);
    expect(failures).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await settled;

    expect(failures).toEqual([
      {
        target: "trace",
        step: "flush",
        error: expect.objectContaining({
          message: FLUSH_TIMEOUT_MESSAGE,
        }),
      },
      { target: "trace", step: "shutdown", error: stuck },
    ]);
    vi.useRealTimers();
    vi.restoreAllMocks();
    const reader = createClient({
      url: pathToFileURL(sqlitePath).href,
    });
    const rows = await reader.execute(
      "select count(*) as n from spans",
    );
    reader.close();
    expect(rows.rows[0]?.["n"]).toBe(1);
  });

  it("names a passed exporter's export still unfinished when closing ends", async () => {
    vi.useFakeTimers();
    const sdk = await createTraceSdk({
      exporters: [new NeverReportingExporter()],
    });
    endOneSpan(sdk);

    let failures: TraceShutdownError["failures"] = [];
    const settled = failuresOf(sdk).then((value) => {
      failures = value;
    });
    await vi.advanceTimersByTimeAsync(30000);
    await settled;

    expect(failures).toEqual([
      {
        target: "trace",
        step: "flush",
        error: expect.objectContaining({
          message: FLUSH_TIMEOUT_MESSAGE,
        }),
      },
      {
        target: "exporters[0]",
        step: "shutdown",
        error: expect.objectContaining({
          message:
            "exporters[0] had 1 span(s) still being exported when closing finished",
        }),
      },
    ]);
  });
});
