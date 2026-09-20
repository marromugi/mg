import { SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { beforeEach, describe, expect, it } from "vitest";
import { startRootSpan } from "./otel-span.js";
import { createTraceSdk } from "./otel/sdk.js";

const setup = () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer("test");
  return { exporter, provider, tracer };
};

describe("startRootSpan / OtelSpan", () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  it("links root, child and grandchild spans by parent span id", async () => {
    const root = startRootSpan(ctx.tracer, "root");
    const child = root.startSpan("child");
    const grandchild = child.startSpan("grandchild");

    grandchild.end();
    child.end();
    root.end();

    await ctx.provider.forceFlush();
    const spans = ctx.exporter.getFinishedSpans();
    expect(spans).toHaveLength(3);

    const byName = Object.fromEntries(
      spans.map((span) => [span.name, span]),
    );
    expect(byName["root"]).toBeDefined();
    expect(byName["child"]).toBeDefined();
    expect(byName["grandchild"]).toBeDefined();

    expect(byName["root"]?.parentSpanContext).toBeUndefined();
    expect(byName["child"]?.parentSpanContext?.spanId).toBe(
      byName["root"]?.spanContext().spanId,
    );
    expect(byName["grandchild"]?.parentSpanContext?.spanId).toBe(
      byName["child"]?.spanContext().spanId,
    );
  });

  it("records attributes given at start and via setAttributes", async () => {
    const root = startRootSpan(ctx.tracer, "root", {
      "start.attr": "a",
    });
    root.setAttributes({ "later.attr": 1 });
    root.end();

    await ctx.provider.forceFlush();
    const [span] = ctx.exporter.getFinishedSpans();
    expect(span?.attributes["start.attr"]).toBe("a");
    expect(span?.attributes["later.attr"]).toBe(1);
  });

  it("records events with their attributes via addEvent", async () => {
    const root = startRootSpan(ctx.tracer, "root");
    root.addEvent("did-something", { count: 3 });
    root.end();

    await ctx.provider.forceFlush();
    const [span] = ctx.exporter.getFinishedSpans();
    expect(span?.events).toHaveLength(1);
    expect(span?.events[0]?.name).toBe("did-something");
    expect(span?.events[0]?.attributes?.["count"]).toBe(3);
  });

  it("sets status ERROR and an exception event when end is called with an error", async () => {
    const root = startRootSpan(ctx.tracer, "root");
    root.end(new Error("x"));

    await ctx.provider.forceFlush();
    const [span] = ctx.exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.status.message).toBe("x");
    const exceptionEvents = span?.events.filter(
      (event) => event.name === "exception",
    );
    expect(exceptionEvents).toHaveLength(1);
  });

  it("leaves status UNSET when end is called without an error", async () => {
    const root = startRootSpan(ctx.tracer, "root");
    root.end();

    await ctx.provider.forceFlush();
    const [span] = ctx.exporter.getFinishedSpans();
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
  });
});

describe("startRoot", () => {
  it("creates a root span with no parent and a different trace id, keeping the same session id", async () => {
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({
      sessionId: "s1",
      exporters: [inMemory],
    });

    const a = startRootSpan(sdk.tracer, "a");
    const b = a.startRoot("b");
    b.end();
    a.end();

    await sdk.shutdown();

    const spans = inMemory.getFinishedSpans();
    const byName = Object.fromEntries(
      spans.map((span) => [span.name, span]),
    );

    expect(spans.map((span) => span.name).sort()).toEqual(["a", "b"]);
    expect(byName["b"]?.parentSpanContext).toBeUndefined();
    expect(byName["b"]?.spanContext().traceId).not.toBe(
      byName["a"]?.spanContext().traceId,
    );
    expect(byName["a"]?.resource.attributes["session.id"]).toBe("s1");
    expect(byName["b"]?.resource.attributes["session.id"]).toBe("s1");
  });

  it("keeps a child of the new root in the same trace, with the new root as its parent", async () => {
    const inMemory = new InMemorySpanExporter();
    const sdk = await createTraceSdk({ exporters: [inMemory] });

    const a = startRootSpan(sdk.tracer, "a");
    const b = a.startRoot("b");
    const c = b.startSpan("c");
    c.end();
    b.end();
    a.end();

    await sdk.shutdown();

    const spans = inMemory.getFinishedSpans();
    const byName = Object.fromEntries(
      spans.map((span) => [span.name, span]),
    );

    expect(spans.map((span) => span.name).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(byName["c"]?.spanContext().traceId).toBe(
      byName["b"]?.spanContext().traceId,
    );
    expect(byName["c"]?.parentSpanContext?.spanId).toBe(
      byName["b"]?.spanContext().spanId,
    );
  });
});
