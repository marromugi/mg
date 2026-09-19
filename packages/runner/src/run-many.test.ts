import type { GenerateResponse, Message, Provider } from "@mg/core";
import type { Connector, Workspace } from "@mg/workspace";
import { defineWorkspace } from "@mg/workspace";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, test } from "vitest";
import type { RunConfig } from "./config.js";
import type { RunCase } from "./run-many.js";
import { runMany } from "./run-many.js";

const lastUserContent = (messages: readonly Message[]): string => {
  const last = [...messages]
    .reverse()
    .find((message) => message.role === "user");
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

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 1000,
): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs)
      throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const providerByLastMessage = (
  script: (id: string) => GenerateResponse | Promise<GenerateResponse>,
): Provider => ({
  generate: async (request) =>
    script(lastUserContent(request.messages)),
  stream: () => {
    throw new Error("stream is not scripted");
  },
});

const baseConfig = (
  provider: Provider,
  exporter?: InMemorySpanExporter,
): RunConfig => ({
  name: "example",
  provider,
  harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
  ...(exporter ? { trace: { exporters: [exporter] } } : {}),
});

const fakeConnector = (opened: { count: number }): Connector => ({
  kind: "fake",
  open: async () => {
    opened.count++;
    return { tools: [], close: async () => {} };
  },
});

const fakeWorkspace = (opened: { count: number }): Workspace =>
  defineWorkspace({
    name: "fake-workspace",
    connectors: [fakeConnector(opened)],
  });

describe("runMany", () => {
  test("3 cases, concurrency 1: outcomes in input order, distinct session ids, each root span carries its case id", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = providerByLastMessage((id) => ({
      parts: [{ type: "text", text: id }],
      finishReason: "stop",
    }));
    const config = baseConfig(provider, exporter);
    const cases = ["a", "b", "c"].map(makeCase);

    const outcomes = await runMany(config, cases);

    expect(outcomes.map((outcome) => outcome.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    for (const outcome of outcomes) {
      expect("result" in outcome).toBe(true);
    }
    const sessionIds = outcomes.map((outcome) => outcome.sessionId);
    expect(new Set(sessionIds).size).toBe(3);

    const rootSpans = exporter
      .getFinishedSpans()
      .filter((span) => span.name === "mg.run");
    expect(rootSpans).toHaveLength(3);
    const caseAttrs = rootSpans.map(
      (span) => span.attributes["mg.run.case"],
    );
    expect(new Set(caseAttrs)).toEqual(new Set(["a", "b", "c"]));
  });

  test("concurrency 2: at most 2 cases run at once", async () => {
    const controllers = new Map<
      string,
      {
        promise: Promise<GenerateResponse>;
        resolve: (r: GenerateResponse) => void;
      }
    >();
    for (const id of ["a", "b", "c"]) {
      controllers.set(id, deferred<GenerateResponse>());
    }
    let active = 0;
    let maxActive = 0;
    const calls: string[] = [];
    const provider: Provider = {
      generate: async (request) => {
        const id = lastUserContent(request.messages);
        calls.push(id);
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

    await waitFor(() => calls.length === 2);
    expect(active).toBe(2);
    controllers.get("a")!.resolve({
      parts: [{ type: "text", text: "a" }],
      finishReason: "stop",
    });
    await waitFor(() => calls.includes("c"));
    expect(active).toBe(2);
    controllers.get("b")!.resolve({
      parts: [{ type: "text", text: "b" }],
      finishReason: "stop",
    });
    controllers.get("c")!.resolve({
      parts: [{ type: "text", text: "c" }],
      finishReason: "stop",
    });

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
      return {
        parts: [{ type: "text", text: id }],
        finishReason: "stop",
      };
    });
    const config = baseConfig(provider);
    const cases = ["a", "b", "c"].map(makeCase);

    const outcomes = await runMany(config, cases);

    expect("result" in outcomes[0]).toBe(true);
    expect("error" in outcomes[1]).toBe(true);
    expect("result" in outcomes[2]).toBe(true);
  });

  test("concurrency: 0 rejects with a RangeError", async () => {
    const provider = providerByLastMessage((id) => ({
      parts: [{ type: "text", text: id }],
      finishReason: "stop",
    }));
    const config = baseConfig(provider);

    await expect(
      runMany(config, [makeCase("a")], { concurrency: 0 }),
    ).rejects.toThrow(RangeError);
  });

  test("concurrency: NaN rejects with a RangeError", async () => {
    const provider = providerByLastMessage((id) => ({
      parts: [{ type: "text", text: id }],
      finishReason: "stop",
    }));
    const config = baseConfig(provider);

    await expect(
      runMany(config, [makeCase("a")], { concurrency: Number.NaN }),
    ).rejects.toThrow(RangeError);
  });

  test("concurrency: 1.5 rejects with a RangeError", async () => {
    const provider = providerByLastMessage((id) => ({
      parts: [{ type: "text", text: id }],
      finishReason: "stop",
    }));
    const config = baseConfig(provider);

    await expect(
      runMany(config, [makeCase("a")], { concurrency: 1.5 }),
    ).rejects.toThrow(RangeError);
  });

  test("a workspace config with concurrency 2 rejects with a RangeError, without opening the workspace or calling the provider", async () => {
    const opened = { count: 0 };
    let providerCalled = false;
    const provider: Provider = {
      generate: async () => {
        providerCalled = true;
        return {
          parts: [{ type: "text", text: "a" }],
          finishReason: "stop",
        };
      },
      stream: () => {
        providerCalled = true;
        throw new Error("stream is not scripted");
      },
    };
    const config: RunConfig = {
      ...baseConfig(provider),
      workspace: fakeWorkspace(opened),
    };

    await expect(
      runMany(config, [makeCase("a")], { concurrency: 2 }),
    ).rejects.toThrow(
      new RangeError("workspace requires concurrency 1, got 2"),
    );

    expect(opened.count).toBe(0);
    expect(providerCalled).toBe(false);
  });

  test("a workspace config with concurrency omitted runs as usual", async () => {
    const opened = { count: 0 };
    const provider = providerByLastMessage((id) => ({
      parts: [{ type: "text", text: id }],
      finishReason: "stop",
    }));
    const config: RunConfig = {
      ...baseConfig(provider),
      workspace: fakeWorkspace(opened),
    };

    const outcomes = await runMany(config, [makeCase("a")]);

    expect(opened.count).toBe(1);
    expect("result" in outcomes[0]).toBe(true);
  });

  test("a workspace config with concurrency 1 runs as usual", async () => {
    const opened = { count: 0 };
    const provider = providerByLastMessage((id) => ({
      parts: [{ type: "text", text: id }],
      finishReason: "stop",
    }));
    const config: RunConfig = {
      ...baseConfig(provider),
      workspace: fakeWorkspace(opened),
    };

    const outcomes = await runMany(config, [makeCase("a")], {
      concurrency: 1,
    });

    expect(opened.count).toBe(1);
    expect("result" in outcomes[0]).toBe(true);
  });

  test("a config without a workspace still allows concurrency 2", async () => {
    const controllers = new Map<
      string,
      {
        promise: Promise<GenerateResponse>;
        resolve: (r: GenerateResponse) => void;
      }
    >();
    for (const id of ["a", "b"]) {
      controllers.set(id, deferred<GenerateResponse>());
    }
    const calls: string[] = [];
    const provider: Provider = {
      generate: async (request) => {
        const id = lastUserContent(request.messages);
        calls.push(id);
        return await controllers.get(id)!.promise;
      },
      stream: () => {
        throw new Error("stream is not scripted");
      },
    };
    const config = baseConfig(provider);
    const cases = ["a", "b"].map(makeCase);

    const resultPromise = runMany(config, cases, { concurrency: 2 });

    await waitFor(() => calls.length === 2);
    controllers.get("a")!.resolve({
      parts: [{ type: "text", text: "a" }],
      finishReason: "stop",
    });
    controllers.get("b")!.resolve({
      parts: [{ type: "text", text: "b" }],
      finishReason: "stop",
    });

    const outcomes = await resultPromise;

    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) {
      expect("result" in outcome).toBe(true);
    }
  });

  test("aborting after the first case starts leaves the rest unstarted, as error outcomes", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const provider: Provider = {
      generate: async (request) => {
        const id = lastUserContent(request.messages);
        calls.push(id);
        controller.abort();
        return {
          parts: [{ type: "text", text: id }],
          finishReason: "stop",
        };
      },
      stream: () => {
        throw new Error("stream is not scripted");
      },
    };
    const config = baseConfig(provider);
    const cases = ["a", "b", "c"].map(makeCase);

    const outcomes = await runMany(config, cases, {
      signal: controller.signal,
    });

    expect(calls).toEqual(["a"]);
    expect("result" in outcomes[0]).toBe(true);
    expect("error" in outcomes[1]).toBe(true);
    expect("error" in outcomes[2]).toBe(true);
  });
});
