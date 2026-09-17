import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type {
  ReadableSpan,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { jsonAttribute } from "../json.js";
import { ATTR, SPAN } from "../vocabulary.js";
import { startRootSpan } from "../otel-span.js";
import { GenAiMappingExporter } from "./genai-exporter.js";

class FakeExporter implements SpanExporter {
  shutdownCalls = 0;

  export(
    _spans: ReadableSpan[],
    resultCallback: Parameters<SpanExporter["export"]>[1],
  ): void {
    resultCallback({ code: 0 });
  }

  shutdown(): Promise<void> {
    this.shutdownCalls += 1;
    return Promise.resolve();
  }
}

class FakeExporterWithForceFlush extends FakeExporter {
  forceFlushCalls = 0;

  forceFlush(): Promise<void> {
    this.forceFlushCalls += 1;
    return Promise.resolve();
  }
}

describe("GenAiMappingExporter", () => {
  const setup = () => {
    const inner = new InMemorySpanExporter();
    const exporter = new GenAiMappingExporter(inner);
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const tracer = provider.getTracer("test");
    return { inner, tracer };
  };

  it("adds the gen_ai attributes while keeping mg.* attributes and span identity intact", async () => {
    const { inner, tracer } = setup();

    const mgAttributes = {
      [ATTR.op]: "llm",
      [ATTR.llmProvider]: "openrouter",
      [ATTR.llmModel]: "gpt-4",
      [ATTR.llmInputTokens]: 10,
      [ATTR.llmOutputTokens]: 20,
      [ATTR.llmFinishReason]: "stop",
      [ATTR.llmInputMessages]: jsonAttribute([
        { role: "user", content: "hi" },
      ]),
      [ATTR.llmOutputMessages]: jsonAttribute([
        { role: "assistant", content: "hello" },
      ]),
    };

    const span = startRootSpan(tracer, SPAN.llm, mgAttributes);
    span.end();

    const [exported] = inner.getFinishedSpans();
    expect(exported).toBeDefined();
    expect(exported.name).toBe(SPAN.llm);
    expect(exported.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(exported.ended).toBe(true);

    for (const [key, value] of Object.entries(mgAttributes)) {
      expect(exported.attributes[key]).toEqual(value);
    }

    expect(exported.attributes["gen_ai.operation.name"]).toBe("chat");
    expect(exported.attributes["gen_ai.provider.name"]).toBe(
      "openrouter",
    );
    expect(exported.attributes["gen_ai.request.model"]).toBe("gpt-4");
    expect(exported.attributes["gen_ai.usage.input_tokens"]).toBe(10);
    expect(exported.attributes["gen_ai.usage.output_tokens"]).toBe(20);
    expect(exported.attributes["gen_ai.input.messages"]).toBeDefined();
    expect(exported.attributes["gen_ai.output.messages"]).toBeDefined();
  });

  it("leaves attributes unchanged for a span with an unknown mg.op", async () => {
    const { inner, tracer } = setup();

    const span = startRootSpan(tracer, "other", {
      [ATTR.op]: "unknown",
    });
    span.end();

    const [exported] = inner.getFinishedSpans();
    expect(exported.attributes).toEqual({ [ATTR.op]: "unknown" });
  });

  it("delegates shutdown and forceFlush to the inner exporter", async () => {
    const inner = new FakeExporterWithForceFlush();
    const exporter = new GenAiMappingExporter(inner);

    await exporter.shutdown();
    await exporter.forceFlush();

    expect(inner.shutdownCalls).toBe(1);
    expect(inner.forceFlushCalls).toBe(1);
  });

  it("resolves forceFlush when the inner exporter has no forceFlush", async () => {
    const inner = new FakeExporter();
    const exporter = new GenAiMappingExporter(inner);

    await expect(exporter.forceFlush()).resolves.toBeUndefined();
  });
});
