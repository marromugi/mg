import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startRootSpan } from "../otel-span.js";
import { JsonlSpanExporter } from "./jsonl-exporter.js";

describe("JsonlSpanExporter", () => {
  let dir: string;
  let jsonlPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mg-trace-"));
    jsonlPath = join(dir, "spans.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const setup = () => {
    const exporter = new JsonlSpanExporter(jsonlPath);
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

  it("appends one valid JSON line per span without interleaving", async () => {
    const { exporter, tracer } = setup();

    for (let i = 0; i < 5; i++) {
      const span = startRootSpan(tracer, `span-${i}`);
      span.end();
    }

    await exporter.shutdown();

    const lines = readFileSync(jsonlPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    const names = lines.map((line) => JSON.parse(line).name).sort();
    expect(names).toEqual([
      "span-0",
      "span-1",
      "span-2",
      "span-3",
      "span-4",
    ]);
  });

  it("round-trips traceId, spanId, parentSpanId, attributes and events", async () => {
    const { tracer, exporter } = setup();

    const root = startRootSpan(tracer, "root", { "start.attr": "a" });
    root.setAttributes({ "later.attr": 1 });
    root.addEvent("did-something", { count: 3 });
    const child = root.startSpan("child");
    child.end();
    root.end();

    await exporter.shutdown();

    const lines = readFileSync(jsonlPath, "utf8").trim().split("\n");
    const spans = lines.map((line) => JSON.parse(line));
    const rootLine = spans.find((span) => span.name === "root");
    const childLine = spans.find((span) => span.name === "child");

    expect(rootLine.parentSpanId).toBeUndefined();
    expect(childLine.parentSpanId).toBe(rootLine.spanId);
    expect(rootLine.traceId).toBe(childLine.traceId);
    expect(rootLine.attributes["start.attr"]).toBe("a");
    expect(rootLine.attributes["later.attr"]).toBe(1);
    expect(rootLine.events).toEqual([
      {
        name: "did-something",
        time: expect.any(String),
        attributes: { count: 3 },
      },
    ]);
    expect(rootLine.status).toEqual({ code: 0 });
  });

  it("carries the resource's session id and service name on every line", async () => {
    const { tracer, exporter } = setup();

    const root = startRootSpan(tracer, "root");
    const child = root.startSpan("child");
    child.end();
    root.end();

    await exporter.shutdown();

    const lines = readFileSync(jsonlPath, "utf8").trim().split("\n");
    const spans = lines.map((line) => JSON.parse(line));
    const rootLine = spans.find((span) => span.name === "root");
    const childLine = spans.find((span) => span.name === "child");

    expect(rootLine.sessionId).toBe("s1");
    expect(rootLine.serviceName).toBe("svc");
    expect(childLine.sessionId).toBe(rootLine.sessionId);
    expect(childLine.serviceName).toBe(rootLine.serviceName);
  });

  it("resolves shutdown and can be called once more without error", async () => {
    const { exporter } = setup();
    await exporter.shutdown();
    await expect(exporter.shutdown()).resolves.toBeUndefined();
  });

  it("creates missing parent directories before writing", async () => {
    const nestedPath = join(dir, "nested", "spans.jsonl");
    const exporter = new JsonlSpanExporter(nestedPath);
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const tracer = provider.getTracer("test");

    const root = startRootSpan(tracer, "root");
    root.end();

    await exporter.shutdown();

    const lines = readFileSync(nestedPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).name).toBe("root");
  });
});
