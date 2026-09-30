import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type {
  ReadableSpan,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";
import { startRootSpan } from "../otel-span.js";
import { ATTR, SPAN } from "../vocabulary.js";
import { createOtlpExporter } from "./otlp.js";

type Received = { headers: IncomingHttpHeaders; body: Buffer };
type ExportResult = { code: number; error?: Error };

const startReceiver = async (delayMs: number | "never" = 0) => {
  const requests: Received[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      if (delayMs === "never") return;
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      }, delayMs);
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const { port } = server.address() as AddressInfo;
  return {
    requests,
    url: `http://127.0.0.1:${port}/v1/traces`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
};

const makeSpan = (
  attributes: Record<string, string> = {},
): ReadableSpan => {
  const memory = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(memory)],
  });
  startRootSpan(provider.getTracer("test"), SPAN.llm, attributes).end();
  return memory.getFinishedSpans()[0];
};

const exportSpan = (
  exporter: SpanExporter,
  span: ReadableSpan = makeSpan(),
): Promise<{ result: ExportResult; elapsedMs: number }> => {
  const start = Date.now();
  return new Promise((resolve) => {
    exporter.export([span], (result) =>
      resolve({ result, elapsedMs: Date.now() - start }),
    );
  });
};

const ignoredHeaders = [
  "host",
  "connection",
  "transfer-encoding",
  "content-length",
];
const headerNames = (headers: IncomingHttpHeaders): string[] =>
  Object.keys(headers)
    .filter((name) => !ignoredHeaders.includes(name))
    .sort();

describe("createOtlpExporter", () => {
  const cleanups: (() => void | Promise<void>)[] = [];
  const setEnv = (values: Record<string, string>) => {
    for (const [key, value] of Object.entries(values)) {
      const before = process.env[key];
      process.env[key] = value;
      cleanups.push(() => {
        if (before === undefined) delete process.env[key];
        else process.env[key] = before;
      });
    }
  };
  const receiver = async (delayMs: number | "never" = 0) => {
    const r = await startReceiver(delayMs);
    cleanups.push(r.close);
    return r;
  };
  const create = (
    options: Parameters<typeof createOtlpExporter>[0],
  ) => {
    const exporter = createOtlpExporter(options);
    cleanups.push(() => exporter.shutdown());
    return exporter;
  };

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  it("sends the given headers plus content type and user agent, ignoring headers from the environment", async () => {
    setEnv({
      OTEL_EXPORTER_OTLP_HEADERS: "b=2",
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "c=3",
    });
    const r = await receiver();
    const { result } = await exportSpan(
      create({ url: r.url, headers: { a: "1" } }),
    );

    expect(result.code).toBe(0);
    const { headers } = r.requests[0];
    expect(headerNames(headers)).toEqual([
      "a",
      "content-type",
      "user-agent",
    ]);
    expect(headers.a).toBe("1");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["user-agent"]).toMatch(
      /^OTel-OTLP-Exporter-JavaScript\//,
    );
  });

  it("sends only content type and user agent when no headers are given", async () => {
    const r = await receiver();
    await exportSpan(create({ url: r.url }));

    expect(headerNames(r.requests[0].headers)).toEqual([
      "content-type",
      "user-agent",
    ]);
  });

  it("ignores timeout and compression from the environment", async () => {
    setEnv({
      OTEL_EXPORTER_OTLP_TIMEOUT: "1",
      OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: "1",
      OTEL_EXPORTER_OTLP_COMPRESSION: "gzip",
      OTEL_EXPORTER_OTLP_TRACES_COMPRESSION: "gzip",
    });
    const r = await receiver(200);
    const { result } = await exportSpan(create({ url: r.url }));

    expect(result.code).toBe(0);
    expect(r.requests[0].headers["content-encoding"]).toBeUndefined();
    expect(() =>
      JSON.parse(r.requests[0].body.toString()),
    ).not.toThrow();
  });

  it("fails an export that gets no answer within timeoutMs", async () => {
    const r = await receiver(2000);
    const { result, elapsedMs } = await exportSpan(
      create({ url: r.url, timeoutMs: 100 }),
    );

    expect(result.code).toBe(1);
    expect(elapsedMs).toBeLessThan(1500);
  });

  it("succeeds when the answer comes after the default timeout but within timeoutMs", async () => {
    const r = await receiver(11000);
    const { result } = await exportSpan(
      create({ url: r.url, timeoutMs: 15000 }),
    );

    expect(result.code).toBe(0);
  }, 20000);

  it("refuses a timeoutMs that is not greater than 0 and at most 2147483647", () => {
    const url = "http://127.0.0.1:4318/v1/traces";
    for (const timeoutMs of [0, -1, Number.NaN, Infinity, 2147483648]) {
      expect(() => createOtlpExporter({ url, timeoutMs })).toThrow(
        RangeError,
      );
    }
    expect(() => createOtlpExporter({ url, timeoutMs: 0 })).toThrow(
      "timeoutMs must be greater than 0 and at most 2147483647 milliseconds, got: 0",
    );
    expect(() =>
      createOtlpExporter({ url, timeoutMs: 2147483648 }),
    ).toThrow(
      "timeoutMs must be greater than 0 and at most 2147483647 milliseconds, got: 2147483648",
    );
  });

  it("accepts the smallest and the largest timeoutMs without a timer warning", async () => {
    const warnings: string[] = [];
    const onWarning = (warning: Error) => warnings.push(warning.name);
    process.on("warning", onWarning);
    cleanups.push(() => {
      process.off("warning", onWarning);
    });

    const slow = await receiver(200);
    const first = await exportSpan(
      create({ url: slow.url, timeoutMs: 1 }),
    );
    const fast = await receiver();
    const second = await exportSpan(
      create({ url: fast.url, timeoutMs: 2147483647 }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(first.result.code).toBe(1);
    expect(second.result.code).toBe(0);
    expect(warnings).not.toContain("TimeoutOverflowWarning");
  });

  it("refuses content-type and user-agent headers in any case", () => {
    const url = "http://127.0.0.1:4318/v1/traces";
    expect(() =>
      createOtlpExporter({ url, headers: { "Content-Type": "x/y" } }),
    ).toThrow(
      new RangeError(
        "headers must not include Content-Type: the exporter sets it itself",
      ),
    );
    expect(() =>
      createOtlpExporter({ url, headers: { "user-agent": "z" } }),
    ).toThrow(
      new RangeError(
        "headers must not include user-agent: the exporter sets it itself",
      ),
    );
  });

  it("refuses two header names that differ only in case", () => {
    expect(() =>
      createOtlpExporter({
        url: "http://127.0.0.1:4318/v1/traces",
        headers: { "X-A": "1", "x-a": "2" },
      }),
    ).toThrow(
      new RangeError(
        "headers X-A and x-a differ only in case, and header names ignore case",
      ),
    );
  });

  it("refuses a url that is not an absolute http or https URL", () => {
    for (const url of [
      "not a url",
      "/v1/traces",
      "ftp://localhost:4318/v1/traces",
    ]) {
      expect(() => createOtlpExporter({ url })).toThrow(RangeError);
    }
    expect(() => createOtlpExporter({ url: "not a url" })).toThrow(
      "url must be an absolute http or https URL, got: not a url",
    );
    expect(() =>
      createOtlpExporter({ url: "ftp://localhost:4318/v1/traces" }),
    ).toThrow(
      "url must be an absolute http or https URL, got: ftp://localhost:4318/v1/traces",
    );
  });

  it("accepts an https url", () => {
    expect(() =>
      create({ url: "https://localhost:4318/v1/traces" }),
    ).not.toThrow();
  });

  it("fails the export, without sending, for a header name Node rejects", async () => {
    const r = await receiver();
    const exporter = create({
      url: r.url,
      headers: { "bad name": "v" },
    });
    const { result } = await exportSpan(exporter);

    expect(result.code).toBe(1);
    expect((result.error as NodeJS.ErrnoException).code).toBe(
      "ERR_INVALID_HTTP_TOKEN",
    );
    expect(r.requests).toEqual([]);
  });

  it("sends the gen_ai attributes mapped from the span", async () => {
    const r = await receiver();
    const span = makeSpan({ [ATTR.op]: "llm", [ATTR.llmModel]: "m1" });
    await exportSpan(create({ url: r.url }), span);

    const body = JSON.parse(r.requests[0].body.toString()) as {
      resourceSpans: {
        scopeSpans: {
          spans: {
            attributes: {
              key: string;
              value: { stringValue?: string };
            }[];
          }[];
        }[];
      }[];
    };
    const attributes =
      body.resourceSpans[0].scopeSpans[0].spans[0].attributes;
    expect(
      attributes.find((a) => a.key === "gen_ai.request.model")?.value
        .stringValue,
    ).toBe("m1");
  });

  it("reports the first invalid value in the order url, timeoutMs, reserved header, header case", () => {
    const url = "http://127.0.0.1:4318/v1/traces";
    expect(() =>
      createOtlpExporter({ url: "not a url", timeoutMs: 0 }),
    ).toThrow(
      "url must be an absolute http or https URL, got: not a url",
    );
    expect(() =>
      createOtlpExporter({
        url,
        timeoutMs: 0,
        headers: { "Content-Type": "x/y" },
      }),
    ).toThrow(
      "timeoutMs must be greater than 0 and at most 2147483647 milliseconds, got: 0",
    );
    expect(() =>
      createOtlpExporter({
        url,
        headers: { "X-A": "1", "x-a": "2", "Content-Type": "x/y" },
      }),
    ).toThrow(
      "headers must not include Content-Type: the exporter sets it itself",
    );
  });

  it("fails an export with no answer after about 10000 ms when timeoutMs is not given", async () => {
    const r = await receiver("never");
    const { result, elapsedMs } = await exportSpan(
      create({ url: r.url }),
    );

    expect(result.code).toBe(1);
    expect(elapsedMs).toBeGreaterThanOrEqual(9500);
    expect(elapsedMs).toBeLessThanOrEqual(12000);
  }, 20000);
});
