import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import type {
  ReadableSpan,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { toSpanRecord } from "./record.js";

type ExportResultCallback = Parameters<SpanExporter["export"]>[1];

export class JsonlSpanExporter implements SpanExporter {
  private pending: Promise<void>;

  constructor(private readonly path: string) {
    this.pending = fs
      .mkdir(dirname(path), { recursive: true })
      .then(() => undefined);
  }

  export(
    spans: ReadableSpan[],
    resultCallback: ExportResultCallback,
  ): void {
    const lines = spans
      .map((span) => `${JSON.stringify(toSpanRecord(span))}\n`)
      .join("");
    const write = this.pending.then(() =>
      fs.appendFile(this.path, lines),
    );
    this.pending = write.then(
      () => undefined,
      () => undefined,
    );
    write.then(
      () => resultCallback({ code: 0 }),
      (error: unknown) =>
        resultCallback({
          code: 1,
          error:
            error instanceof Error ? error : new Error(String(error)),
        }),
    );
  }

  async shutdown(): Promise<void> {
    await this.pending;
  }
}
