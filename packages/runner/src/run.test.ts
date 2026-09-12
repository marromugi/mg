import type { GenerateResponse, Provider, StreamEvent } from "@mg/core";
import type { HarnessEvent } from "@mg/harness";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "vitest";
import type { RunConfig } from "./config.js";
import { run } from "./run.js";

// createTraceSdk shuts the exporter down before `run` returns, and
// @opentelemetry/sdk-trace-base's InMemorySpanExporter clears its buffer on
// shutdown - so tests capture spans as they are exported instead.
const capturingExporter = (): { exporter: SpanExporter; spans: ReadableSpan[] } => {
  const spans: ReadableSpan[] = [];
  const exporter: SpanExporter = {
    export: (batch, resultCallback) => {
      spans.push(...batch);
      resultCallback({ code: 0 });
    },
    shutdown: async () => {},
  };
  return { exporter, spans };
};

const stubProvider = (responses: readonly GenerateResponse[]): Provider => {
  let index = 0;
  return {
    generate: async () => {
      const response = responses[index];
      index++;
      if (!response) throw new Error("stubProvider: no scripted response left");
      return response;
    },
    stream: () => {
      throw new Error("stubProvider: stream is not scripted");
    },
  };
};

const stubStreamProvider = (turns: readonly StreamEvent[][]): Provider => {
  let index = 0;
  return {
    generate: async () => {
      throw new Error("stubStreamProvider: generate is not scripted");
    },
    stream: () => {
      const events = turns[index];
      index++;
      if (!events) throw new Error("stubStreamProvider: no scripted turn left");
      return (async function* () {
        for (const event of events) {
          yield event;
        }
      })();
    },
  };
};

const throwingProvider = (error: Error): Provider => ({
  generate: async () => {
    throw error;
  },
  stream: () => {
    throw new Error("throwingProvider: stream is not scripted");
  },
});

describe("run", () => {
  test("returns the last result and a non-empty session id", async () => {
    const provider = stubProvider([{ content: "hi", toolCalls: [], finishReason: "stop" }]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
    };

    const outcome = await run(config, []);

    expect(outcome.result.reason).toBe("stop");
    expect(outcome.sessionId.length).toBeGreaterThan(0);
  });

  test("exports an mg.run root span carrying the run name, with mg.harness as its child", async () => {
    const { exporter, spans } = capturingExporter();
    const provider = stubProvider([{ content: "hi", toolCalls: [], finishReason: "stop" }]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      trace: { exporters: [exporter] },
    };

    await run(config, []);

    const rootSpan = spans.find((span) => span.name === "mg.run");
    const harnessSpan = spans.find((span) => span.name === "mg.harness");

    expect(rootSpan).toBeDefined();
    expect(harnessSpan).toBeDefined();
    expect(rootSpan?.attributes["mg.run.name"]).toBe("example");
    expect(harnessSpan?.parentSpanContext?.spanId).toBe(rootSpan?.spanContext().spanId);
    expect(harnessSpan?.spanContext().traceId).toBe(rootSpan?.spanContext().traceId);
  });

  test("onEvent sees text-delta, turn, done in order", async () => {
    const provider = stubStreamProvider([
      [
        { type: "text-delta", delta: "hi" },
        { type: "finish", finishReason: "stop" },
      ],
    ]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: true },
    };

    const seen: HarnessEvent["type"][] = [];
    await run(config, [], { onEvent: (event) => seen.push(event.type) });

    expect(seen).toEqual(["text-delta", "turn", "done"]);
  });

  test("a provider that throws rejects run, ends the root span with an error, and still exports it", async () => {
    const { exporter, spans } = capturingExporter();
    const error = new Error("provider blew up");
    const provider = throwingProvider(error);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      trace: { exporters: [exporter] },
    };

    await expect(run(config, [])).rejects.toThrow(error);

    const rootSpan = spans.find((span) => span.name === "mg.run");
    expect(rootSpan).toBeDefined();
    expect(rootSpan?.status.code).toBe(2);
  });

  test("the sessionId option is honoured on every exported span", async () => {
    const { exporter, spans } = capturingExporter();
    const provider = stubProvider([{ content: "hi", toolCalls: [], finishReason: "stop" }]);
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      trace: { exporters: [exporter] },
    };

    const outcome = await run(config, [], { sessionId: "s1" });

    expect(outcome.sessionId).toBe("s1");
    expect(spans.length).toBeGreaterThan(0);
    for (const span of spans) {
      expect(span.resource.attributes["session.id"]).toBe("s1");
    }
  });
});
