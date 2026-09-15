import type {
  ReadableSpan,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { mapGenAiAttributes } from "./genai-mapping.js";

type ExportResultCallback = Parameters<SpanExporter["export"]>[1];

const withGenAiAttributes = (span: ReadableSpan): ReadableSpan =>
  Object.create(span, {
    attributes: {
      value: {
        ...span.attributes,
        ...mapGenAiAttributes(span.attributes),
      },
      enumerable: true,
    },
  }) as ReadableSpan;

export class GenAiMappingExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(
    spans: ReadableSpan[],
    resultCallback: ExportResultCallback,
  ): void {
    this.inner.export(spans.map(withGenAiAttributes), resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}
