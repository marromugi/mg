import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
