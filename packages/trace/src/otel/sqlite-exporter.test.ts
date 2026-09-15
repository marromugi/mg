import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startRootSpan } from "../otel-span.js";
import { spans } from "../store/schema.js";
import { SqliteTraceReader } from "../store/sqlite-reader.js";
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
    return { db, exporter, provider, tracer };
  };

  it("inserts one row per span", async () => {
    const { db, exporter, tracer } = await setup();

    for (let i = 0; i < 5; i++) {
      const span = startRootSpan(tracer, `span-${i}`);
      span.end();
    }

    await exporter.shutdown();

    const rows = await db.select().from(spans);
    expect(rows).toHaveLength(5);
    await db.$client.close();
  });

  it("round-trips traceId, spanId, parentSpanId, attributes, events and status", async () => {
    const { db, tracer, exporter } = await setup();

    const root = startRootSpan(tracer, "root", { "start.attr": "a" });
    root.addEvent("did-something", { count: 3 });
    const child = root.startSpan("child");
    child.end();
    root.end();

    await exporter.shutdown();

    const rows = await db.select().from(spans);
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

    await db.$client.close();
  });

  it("resolves shutdown and can be called once more without error", async () => {
    const { exporter } = await setup();
    await exporter.shutdown();
    await expect(exporter.shutdown()).resolves.toBeUndefined();
  });

  it("resolves an empty span list with code 0 without inserting", async () => {
    const { db, exporter } = await setup();
    const results: number[] = [];

    exporter.export([], (result) => {
      results.push(result.code);
    });

    expect(results).toEqual([0]);

    await exporter.shutdown();
    const rows = await db.select().from(spans);
    expect(rows).toHaveLength(0);
    await db.$client.close();
  });

  it("does not close the db on shutdown, so a reader sharing the same db can still read afterward", async () => {
    const { db, exporter, tracer } = await setup();

    const root = startRootSpan(tracer, "root", { "start.attr": "a" });
    const child = root.startSpan("child");
    child.end();
    root.end();

    await exporter.shutdown();

    // The db connection stays open; a reader built on the same TraceDb can
    // still query it after the exporter that wrote to it has shut down.
    const reader = new SqliteTraceReader(db);
    const tree = await reader.readSession("s1");

    expect(tree?.traces).toHaveLength(1);
    expect(tree?.traces[0]?.root.name).toBe("root");
    expect(tree?.traces[0]?.root.children).toHaveLength(1);
    expect(tree?.traces[0]?.root.children[0]?.name).toBe("child");

    await db.$client.close();
  });
});
