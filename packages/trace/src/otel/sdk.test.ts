import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startRootSpan } from "../otel-span.js";
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
    const sdk = createTraceSdk({ jsonlPath, sessionId: "s1", serviceName: "svc" });

    const root = startRootSpan(sdk.tracer, "root", { "start.attr": "a" });
    root.addEvent("did-something", { count: 1 });
    const child = root.startSpan("child");
    child.end();
    root.end();

    await sdk.shutdown();

    const lines = readFileSync(jsonlPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const spans = lines.map((line) => JSON.parse(line));
    const rootLine = spans.find((span) => span.name === "root");
    const childLine = spans.find((span) => span.name === "child");

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
    const sdk = createTraceSdk({ exporters: [inMemory] });

    const root = startRootSpan(sdk.tracer, "root");
    root.end();

    const spans = inMemory.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe("root");

    await sdk.shutdown();
  });

  it("resolves shutdown and can be called once without error", async () => {
    const sdk = createTraceSdk();
    await expect(sdk.shutdown()).resolves.toBeUndefined();
  });

  it("puts the given session id and service name on every span's resource", async () => {
    const inMemory = new InMemorySpanExporter();
    const sdk = createTraceSdk({ sessionId: "s1", serviceName: "svc", exporters: [inMemory] });

    const root = startRootSpan(sdk.tracer, "root");
    const child = root.startSpan("child");
    child.end();
    root.end();

    const spans = inMemory.getFinishedSpans();
    expect(spans).toHaveLength(2);
    for (const span of spans) {
      expect(span.resource.attributes["session.id"]).toBe("s1");
      expect(span.resource.attributes["service.name"]).toBe("svc");
    }
    expect(sdk.sessionId).toBe("s1");

    await sdk.shutdown();
  });

  it("generates a session id automatically when none is given", async () => {
    const sdkA = createTraceSdk();
    const sdkB = createTraceSdk();

    expect(typeof sdkA.sessionId).toBe("string");
    expect(sdkA.sessionId.length).toBeGreaterThan(0);
    expect(sdkA.sessionId).not.toBe(sdkB.sessionId);

    await sdkA.shutdown();
    await sdkB.shutdown();
  });
});
