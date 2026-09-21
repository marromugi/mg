import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT_CONTEXT } from "@opentelemetry/api";
import type {
  ReadableSpan,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startRootSpan } from "../otel-span.js";
import { spans } from "../store/schema.js";
import { openTraceDb } from "../store/sqlite.js";
import { createTraceSdk } from "./sdk.js";

describe("createTraceSdk", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mg-trace-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes root and child spans to the jsonl file with matching parent/child ids", async () => {
    const jsonlPath = join(dir, "spans.jsonl");
    const sdk = await createTraceSdk({
      jsonlPath,
      sessionId: "s1",
      serviceName: "svc",
    });

    const root = startRootSpan(sdk.tracer, "root", {
      "start.attr": "a",
    });
    root.addEvent("did-something", { count: 1 });
    const child = root.startSpan("child");
    child.end();
    root.end();

    await sdk.shutdown();

    const lines = readFileSync(jsonlPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const parsed = lines.map((line) => JSON.parse(line));
    const rootLine = parsed.find((span) => span.name === "root");
    const childLine = parsed.find((span) => span.name === "child");

    expect(rootLine).toBeDefined();
    expect(childLine).toBeDefined();
    expect(rootLine.parentSpanId).toBeUndefined();
    expect(childLine.parentSpanId).toBe(rootLine.spanId);
    expect(rootLine.traceId).toBe(childLine.traceId);
    expect(rootLine.attributes["start.attr"]).toBe("a");
    expect(rootLine.events).toHaveLength(1);
    expect(rootLine.events[0].name).toBe("did-something");
    expect(rootLine.events[0].attributes.count).toBe(1);
    expect(typeof rootLine.startTime).toBe("string");
    expect(typeof rootLine.endTime).toBe("string");
    expect(rootLine.status.code).toBe(0);
    expect(rootLine.sessionId).toBe("s1");
    expect(rootLine.serviceName).toBe("svc");
    expect(childLine.sessionId).toBe(rootLine.sessionId);
  });

  it("sends the same spans to additional exporters", async () => {
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const root = startRootSpan(sdk.tracer, "root");
    root.end();

    const finished = inMemory.getFinishedSpans();
    expect(finished).toHaveLength(1);
    expect(finished[0]?.name).toBe("root");

    await sdk.shutdown();
  });

  it("resolves shutdown and can be called once without error", async () => {
    const sdk = await createTraceSdk();
    await expect(sdk.shutdown()).resolves.toBeUndefined();
  });

  it("puts the given session id and service name on every span's resource", async () => {
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({
      sessionId: "s1",
      serviceName: "svc",
      exporters: [inMemory],
    });

    const root = startRootSpan(sdk.tracer, "root");
    const child = root.startSpan("child");
    child.end();
    root.end();

    const finished = inMemory.getFinishedSpans();
    expect(finished).toHaveLength(2);
    for (const span of finished) {
      expect(span.resource.attributes["session.id"]).toBe("s1");
      expect(span.resource.attributes["service.name"]).toBe("svc");
      expect(span.resource.attributes["telemetry.sdk.language"]).toBe(
        "nodejs",
      );
    }
    expect(sdk.sessionId).toBe("s1");

    await sdk.shutdown();
  });

  it("generates a session id automatically when none is given", async () => {
    const sdkA = await createTraceSdk();
    const sdkB = await createTraceSdk();

    expect(typeof sdkA.sessionId).toBe("string");
    expect(sdkA.sessionId.length).toBeGreaterThan(0);
    expect(sdkA.sessionId).not.toBe(sdkB.sessionId);

    await sdkA.shutdown();
    await sdkB.shutdown();
  });

  it("writes root and child spans to the sqlite database with matching parent/child ids", async () => {
    const sqlitePath = join(dir, "spans.db");
    const sdk = await createTraceSdk({
      sqlitePath,
      sessionId: "s1",
      serviceName: "svc",
    });

    const root = startRootSpan(sdk.tracer, "root", {
      "start.attr": "a",
    });
    root.addEvent("did-something", { count: 1 });
    const child = root.startSpan("child");
    child.end();
    root.end();

    await sdk.shutdown();

    const db = await openTraceDb(sqlitePath);
    const rows = await db.select().from(spans);
    expect(rows).toHaveLength(2);

    const rootRow = rows.find((row) => row.name === "root");
    const childRow = rows.find((row) => row.name === "child");

    expect(rootRow).toBeDefined();
    expect(childRow).toBeDefined();
    expect(rootRow?.parentSpanId).toBeNull();
    expect(childRow?.parentSpanId).toBe(rootRow?.spanId);
    expect(rootRow?.traceId).toBe(childRow?.traceId);
    expect(JSON.parse(rootRow?.attributes ?? "{}")["start.attr"]).toBe(
      "a",
    );
    expect(rootRow?.sessionId).toBe("s1");
    expect(rootRow?.serviceName).toBe("svc");

    db.$client.close();
  });

  it("rejects when the sqlite path's parent is a file, not a folder", async () => {
    const blockerPath = join(dir, "blocker");
    writeFileSync(blockerPath, "");
    const sqlitePath = join(blockerPath, "spans.db");

    await expect(createTraceSdk({ sqlitePath })).rejects.toThrow();
  });

  it("rejects with a RangeError when sqlitePath is :memory:", async () => {
    await expect(
      createTraceSdk({ sqlitePath: ":memory:" }),
    ).rejects.toThrow(RangeError);
  });

  it("does not shutdown externally provided exporters, but does export to them, across multiple SDKs", async () => {
    const shutdownCalls: number[] = [];
    const exportedNames: string[] = [];
    const fakeExporter: SpanExporter = {
      export: (readableSpans: ReadableSpan[], resultCallback) => {
        exportedNames.push(...readableSpans.map((span) => span.name));
        resultCallback({ code: 0 });
      },
      shutdown: async () => {
        shutdownCalls.push(1);
      },
    };

    const sdk1 = await createTraceSdk({ exporters: [fakeExporter] });
    const root1 = startRootSpan(sdk1.tracer, "root1");
    root1.end();
    await sdk1.shutdown();

    expect(shutdownCalls).toHaveLength(0);
    expect(exportedNames).toContain("root1");

    const sdk2 = await createTraceSdk({ exporters: [fakeExporter] });
    const root2 = startRootSpan(sdk2.tracer, "root2");
    root2.end();
    await sdk2.shutdown();

    expect(shutdownCalls).toHaveLength(0);
    expect(exportedNames).toContain("root2");
  });

  it("receives the child span before the parent span, in the order they ended, before shutdown is called", async () => {
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const a = startRootSpan(sdk.tracer, "a");
    const b = a.startSpan("b");
    b.end();
    a.end();

    expect(
      inMemory.getFinishedSpans().map((span) => span.name),
    ).toEqual(["b", "a"]);

    await sdk.shutdown();
  });

  it("receives only the span that has ended, leaving its unended parent out", async () => {
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const a = startRootSpan(sdk.tracer, "a");
    const b = a.startSpan("b");
    b.end();

    expect(
      inMemory.getFinishedSpans().map((span) => span.name),
    ).toEqual(["b"]);

    await sdk.shutdown();
  });

  it("orders independent root spans by when they ended, not when they started", async () => {
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const x = startRootSpan(sdk.tracer, "x");
    const y = startRootSpan(sdk.tracer, "y");
    x.end();
    y.end();

    expect(
      inMemory.getFinishedSpans().map((span) => span.name),
    ).toEqual(["x", "y"]);

    await sdk.shutdown();

    const inMemory2 = new InMemorySpanExporter();
    const sdk2 = await createTraceSdk({ exporters: [inMemory2] });

    const x2 = startRootSpan(sdk2.tracer, "x");
    const y2 = startRootSpan(sdk2.tracer, "y");
    y2.end();
    x2.end();

    expect(
      inMemory2.getFinishedSpans().map((span) => span.name),
    ).toEqual(["y", "x"]);

    await sdk2.shutdown();
  });

  it("gives every exporter the same spans in the same order", async () => {
    const inMemory1 = new InMemorySpanExporter();
    const inMemory2 = new InMemorySpanExporter();
    const sdk = await createTraceSdk({
      exporters: [inMemory1, inMemory2],
    });

    const a = startRootSpan(sdk.tracer, "a");
    const b = a.startSpan("b");
    b.end();
    a.end();

    expect(
      inMemory1.getFinishedSpans().map((span) => span.name),
    ).toEqual(["b", "a"]);
    expect(
      inMemory2.getFinishedSpans().map((span) => span.name),
    ).toEqual(["b", "a"]);

    await sdk.shutdown();
  });

  it("waits for an export still in progress before shutdown resolves", async () => {
    const receivedNames: string[] = [];
    const fakeExporter: SpanExporter = {
      export: (readableSpans, resultCallback) => {
        setTimeout(() => {
          receivedNames.push(...readableSpans.map((span) => span.name));
          // 0 is the exporter interface's success code (ExportResultCode.SUCCESS).
          resultCallback({ code: 0 });
        }, 20);
      },
      shutdown: async () => {},
    };

    const sdk = await createTraceSdk({ exporters: [fakeExporter] });
    const root = startRootSpan(sdk.tracer, "a");
    root.end();

    await sdk.shutdown();

    expect(receivedNames).toEqual(["a"]);
  });
});

describe("createTraceSdk's recording, regardless of OpenTelemetry environment variables", () => {
  const OTEL_ENV_VARS = [
    "OTEL_TRACES_SAMPLER",
    "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT",
    "OTEL_ATTRIBUTE_COUNT_LIMIT",
    "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT",
    "OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT",
    "OTEL_SPAN_EVENT_COUNT_LIMIT",
    "OTEL_SPAN_ATTRIBUTE_PER_EVENT_COUNT_LIMIT",
    "OTEL_SPAN_LINK_COUNT_LIMIT",
    "OTEL_SPAN_ATTRIBUTE_PER_LINK_COUNT_LIMIT",
  ] as const;

  let originalEnv: Partial<
    Record<(typeof OTEL_ENV_VARS)[number], string>
  >;

  beforeEach(() => {
    originalEnv = {};
    for (const name of OTEL_ENV_VARS) {
      originalEnv[name] = process.env[name];
    }
  });

  afterEach(() => {
    for (const name of OTEL_ENV_VARS) {
      const value = originalEnv[name];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it("still exports a root span when the sampler env var is set to always_off", async () => {
    process.env.OTEL_TRACES_SAMPLER = "always_off";
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const root = startRootSpan(sdk.tracer, "a");
    root.end();

    expect(
      inMemory.getFinishedSpans().map((span) => span.name),
    ).toEqual(["a"]);

    await sdk.shutdown();
  });

  it("keeps a span's attribute when the attribute count limit env vars are 0", async () => {
    process.env.OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT = "0";
    process.env.OTEL_ATTRIBUTE_COUNT_LIMIT = "0";
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const root = startRootSpan(sdk.tracer, "a", { k: "v" });
    root.end();

    const [span] = inMemory.getFinishedSpans();
    expect(span?.attributes.k).toBe("v");

    await sdk.shutdown();
  });

  it("does not truncate an attribute value when the value length limit env vars are 5", async () => {
    process.env.OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT = "5";
    process.env.OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT = "5";
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const root = startRootSpan(sdk.tracer, "a", { k: "0123456789" });
    root.end();

    const [span] = inMemory.getFinishedSpans();
    expect(span?.attributes.k).toBe("0123456789");

    await sdk.shutdown();
  });

  it("keeps a span's event when the event count limit env var is 0", async () => {
    process.env.OTEL_SPAN_EVENT_COUNT_LIMIT = "0";
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const root = startRootSpan(sdk.tracer, "a");
    root.addEvent("e");
    root.end();

    const [span] = inMemory.getFinishedSpans();
    expect(span?.events).toHaveLength(1);
    expect(span?.events[0]?.name).toBe("e");

    await sdk.shutdown();
  });

  it("keeps an event's attribute when the per-event attribute count limit env var is 0", async () => {
    process.env.OTEL_SPAN_ATTRIBUTE_PER_EVENT_COUNT_LIMIT = "0";
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const root = startRootSpan(sdk.tracer, "a");
    root.addEvent("e", { k: "v" });
    root.end();

    const [span] = inMemory.getFinishedSpans();
    expect(span?.events[0]?.attributes?.k).toBe("v");

    await sdk.shutdown();
  });

  it("keeps a span's link when the link count limit env var is 0", async () => {
    process.env.OTEL_SPAN_LINK_COUNT_LIMIT = "0";
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const t = sdk.tracer.startSpan("t", {}, ROOT_CONTEXT);
    t.end();
    const a = sdk.tracer.startSpan(
      "a",
      { links: [{ context: t.spanContext() }] },
      ROOT_CONTEXT,
    );
    a.end();

    const span = inMemory
      .getFinishedSpans()
      .find((finishedSpan) => finishedSpan.name === "a");
    expect(span?.links).toHaveLength(1);

    await sdk.shutdown();
  });

  it("keeps a link's attribute when the per-link attribute count limit env var is 0", async () => {
    process.env.OTEL_SPAN_ATTRIBUTE_PER_LINK_COUNT_LIMIT = "0";
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const t = sdk.tracer.startSpan("t", {}, ROOT_CONTEXT);
    t.end();
    const a = sdk.tracer.startSpan(
      "a",
      {
        links: [{ context: t.spanContext(), attributes: { k: "v" } }],
      },
      ROOT_CONTEXT,
    );
    a.end();

    const span = inMemory
      .getFinishedSpans()
      .find((finishedSpan) => finishedSpan.name === "a");
    expect(span?.links[0]?.attributes?.k).toBe("v");

    await sdk.shutdown();
  });

  it("keeps 128 attributes on a span when no limit env var is set", async () => {
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const attributes: Record<string, string> = {};
    for (let i = 0; i <= 128; i++) {
      attributes[`k${i}`] = String(i);
    }
    const root = startRootSpan(sdk.tracer, "a", attributes);
    root.end();

    const [span] = inMemory.getFinishedSpans();
    expect(Object.keys(span?.attributes ?? {})).toHaveLength(128);

    await sdk.shutdown();
  });

  it("keeps 128 events on a span when no limit env var is set", async () => {
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const root = startRootSpan(sdk.tracer, "a");
    for (let i = 0; i <= 128; i++) {
      root.addEvent(`e${i}`);
    }
    root.end();

    const [span] = inMemory.getFinishedSpans();
    expect(span?.events).toHaveLength(128);

    await sdk.shutdown();
  });

  it("keeps 128 attributes on an event when no limit env var is set", async () => {
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const attributes: Record<string, string> = {};
    for (let i = 0; i <= 128; i++) {
      attributes[`k${i}`] = String(i);
    }
    const root = startRootSpan(sdk.tracer, "a");
    root.addEvent("e", attributes);
    root.end();

    const [span] = inMemory.getFinishedSpans();
    const event = span?.events.find(
      (finishedEvent) => finishedEvent.name === "e",
    );
    expect(Object.keys(event?.attributes ?? {})).toHaveLength(128);

    await sdk.shutdown();
  });

  it("keeps 128 links on a span when no limit env var is set", async () => {
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const t = sdk.tracer.startSpan("t", {}, ROOT_CONTEXT);
    t.end();
    const links = Array.from({ length: 129 }, () => ({
      context: t.spanContext(),
    }));
    const a = sdk.tracer.startSpan("a", { links }, ROOT_CONTEXT);
    a.end();

    const span = inMemory
      .getFinishedSpans()
      .find((finishedSpan) => finishedSpan.name === "a");
    expect(span?.links).toHaveLength(128);

    await sdk.shutdown();
  });

  it("keeps 128 attributes on a link when no limit env var is set", async () => {
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const attributes: Record<string, string> = {};
    for (let i = 0; i <= 128; i++) {
      attributes[`k${i}`] = String(i);
    }
    const t = sdk.tracer.startSpan("t", {}, ROOT_CONTEXT);
    t.end();
    const a = sdk.tracer.startSpan(
      "a",
      { links: [{ context: t.spanContext(), attributes }] },
      ROOT_CONTEXT,
    );
    a.end();

    const span = inMemory
      .getFinishedSpans()
      .find((finishedSpan) => finishedSpan.name === "a");
    expect(Object.keys(span?.links[0]?.attributes ?? {})).toHaveLength(
      128,
    );

    await sdk.shutdown();
  });
});
