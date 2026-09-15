import type { GenerateResponse, Message, Provider } from "@mg/core";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "vitest";
import type { RunConfig } from "./config.js";
import type { RunCase } from "./run-many.js";
import { runMany } from "./run-many.js";

const lastUserContent = (messages: readonly Message[]): string => {
  const last = [...messages].reverse().find((message) => message.role === "user");
  return last && "content" in last ? last.content : "";
};

const makeCase = (id: string): RunCase => ({
  id,
  messages: [{ role: "user", content: id }],
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 1000): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const providerByLastMessage = (
  script: (id: string) => GenerateResponse | Promise<GenerateResponse>,
): Provider => ({
  generate: async (request) => script(lastUserContent(request.messages)),
  stream: () => {
    throw new Error("stream is not scripted");
  },
});

const baseConfig = (provider: Provider, exporter?: InMemorySpanExporter): RunConfig => ({
  name: "example",
  provider,
  harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
  ...(exporter ? { trace: { exporters: [exporter] } } : {}),
});

describe("runMany", () => {
  test("3 cases, concurrency 1: outcomes in input order, distinct session ids, each root span carries its case id", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = providerByLastMessage((id) => ({
      content: id,
      toolCalls: [],
      finishReason: "stop",
    }));
    const config = baseConfig(provider, exporter);
    const cases = ["a", "b", "c"].map(makeCase);

    const outcomes = await runMany(config, cases);

    expect(outcomes.map((outcome) => outcome.id)).toEqual(["a", "b", "c"]);
    for (const outcome of outcomes) {
      expect("result" in outcome).toBe(true);
    }
    const sessionIds = outcomes.map((outcome) => outcome.sessionId);
    expect(new Set(sessionIds).size).toBe(3);

    const rootSpans = exporter.getFinishedSpans().filter((span) => span.name === "mg.run");
    expect(rootSpans).toHaveLength(3);
    const caseAttrs = rootSpans.map((span) => span.attributes["mg.run.case"]);
    expect(new Set(caseAttrs)).toEqual(new Set(["a", "b", "c"]));
  });

  test("concurrency 2: at most 2 cases run at once", async () => {
    const controllers = new Map<string, { promise: Promise<GenerateResponse>; resolve: (r: GenerateResponse) => void }>();
    for (const id of ["a", "b", "c"]) {
      controllers.set(id, deferred<GenerateResponse>());
    }
    let active = 0;
    let maxActive = 0;
    const provider: Provider = {
      generate: async (request) => {
        const id = lastUserContent(request.messages);
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          return await controllers.get(id)!.promise;
        } finally {
          active--;
        }
      },
      stream: () => {
        throw new Error("stream is not scripted");
      },
    };
    const config = baseConfig(provider);
    const cases = ["a", "b", "c"].map(makeCase);

    const resultPromise = runMany(config, cases, { concurrency: 2 });

    await waitFor(() => active === 2);
    controllers.get("a")!.resolve({ content: "a", toolCalls: [], finishReason: "stop" });
    await waitFor(() => active === 2);
    controllers.get("b")!.resolve({ content: "b", toolCalls: [], finishReason: "stop" });
    controllers.get("c")!.resolve({ content: "c", toolCalls: [], finishReason: "stop" });

    const outcomes = await resultPromise;

    expect(maxActive).toBe(2);
    expect(outcomes).toHaveLength(3);
    for (const outcome of outcomes) {
      expect("result" in outcome).toBe(true);
    }
  });

  test("one case's provider throws: that outcome has error, the other two have result", async () => {
    const provider = providerByLastMessage((id) => {
      if (id === "b") throw new Error("boom");
      return { content: id, toolCalls: [], finishReason: "stop" };
    });
    const config = baseConfig(provider);
    const cases = ["a", "b", "c"].map(makeCase);

    const outcomes = await runMany(config, cases);

    expect("result" in outcomes[0]!).toBe(true);
    expect("error" in outcomes[1]!).toBe(true);
    expect("result" in outcomes[2]!).toBe(true);
  });

  test("concurrency: 0 rejects with a RangeError", async () => {
    const provider = providerByLastMessage((id) => ({
      content: id,
      toolCalls: [],
      finishReason: "stop",
    }));
    const config = baseConfig(provider);

    await expect(runMany(config, [makeCase("a")], { concurrency: 0 })).rejects.toThrow(RangeError);
  });

  test("aborting after the first case starts leaves the rest unstarted, as error outcomes", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const provider: Provider = {
      generate: async (request) => {
        const id = lastUserContent(request.messages);
        calls.push(id);
        controller.abort();
        return { content: id, toolCalls: [], finishReason: "stop" };
      },
      stream: () => {
        throw new Error("stream is not scripted");
      },
    };
    const config = baseConfig(provider);
    const cases = ["a", "b", "c"].map(makeCase);

    const outcomes = await runMany(config, cases, { signal: controller.signal });

    expect(calls).toEqual(["a"]);
    expect("result" in outcomes[0]!).toBe(true);
    expect("error" in outcomes[1]!).toBe(true);
    expect("error" in outcomes[2]!).toBe(true);
  });
});
