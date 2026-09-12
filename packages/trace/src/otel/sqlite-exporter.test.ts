import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startRootSpan } from "../otel-span.js";
import { spans } from "../store/schema.js";
import { openTraceDb } from "../store/sqlite.js";
import { SqliteSpanExporter } from "./sqlite-exporter.js";

describe("SqliteSpanExporter", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mg-trace-sqlite-"));
    dbPath = join(dir, "spans.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const setup = async () => {
    const db = await openTraceDb(dbPath);
    const exporter = new SqliteSpanExporter(db);
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes({
        "session.id": "s1",
        "service.name": "svc",
      }),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const tracer = provider.getTracer("test");
    return { exporter, provider, tracer };
  };

  it("inserts one row per span", async () => {
    const { exporter, tracer } = await setup();

    for (let i = 0; i < 5; i++) {
      const span = startRootSpan(tracer, `span-${i}`);
      span.end();
    }

    await exporter.shutdown();

    const readDb = await openTraceDb(dbPath);
    const rows = await readDb.select().from(spans);
    expect(rows).toHaveLength(5);
    await readDb.$client.close();
  });

  it("round-trips traceId, spanId, parentSpanId, attributes, events and status", async () => {
    const { tracer, exporter } = await setup();

    const root = startRootSpan(tracer, "root", { "start.attr": "a" });
    root.addEvent("did-something", { count: 3 });
    const child = root.startSpan("child");
    child.end();
    root.end();

    await exporter.shutdown();

    const readDb = await openTraceDb(dbPath);
    const rows = await readDb.select().from(spans);
    const rootRow = rows.find((row) => row.name === "root");
    const childRow = rows.find((row) => row.name === "child");

    expect(rootRow?.parentSpanId).toBeNull();
    expect(childRow?.parentSpanId).toBe(rootRow?.spanId);
    expect(rootRow?.traceId).toBe(childRow?.traceId);
    expect(JSON.parse(rootRow?.attributes ?? "{}")["start.attr"]).toBe("a");
    expect(JSON.parse(rootRow?.events ?? "[]")).toEqual([
      { name: "did-something", time: expect.any(String), attributes: { count: 3 } },
    ]);
    expect(rootRow?.statusCode).toBe(0);
    expect(rootRow?.sessionId).toBe("s1");
    expect(rootRow?.serviceName).toBe("svc");

    await readDb.$client.close();
  });

  it("accepts a promise of the db and awaits it before inserting", async () => {
    const dbPromise = openTraceDb(dbPath);
    const exporter = new SqliteSpanExporter(dbPromise);
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const tracer = provider.getTracer("test");

    const root = startRootSpan(tracer, "root");
    root.end();

    await exporter.shutdown();

    const readDb = await openTraceDb(dbPath);
    const rows = await readDb.select().from(spans);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("root");
    await readDb.$client.close();
  });

  it("resolves shutdown and can be called once more without error", async () => {
    const { exporter } = await setup();
    await exporter.shutdown();
    await expect(exporter.shutdown()).resolves.toBeUndefined();
  });
});
