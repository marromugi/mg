import { describe, expect, it } from "vitest";
import type { HarnessDefinition } from "../definition/index.js";
import {
  createFakeRun,
  finishedResult,
  untilAborted,
} from "../test/fake-run.js";
import { createMemorySecretStore } from "../test/memory-secret-store.js";
import { createTestRuns, type TestRunEvent } from "./index.js";

const DEFINITION: HarnessDefinition = {
  id: "h1",
  name: "chat",
  provider: { kind: "openrouter" },
  harness: {
    kind: "loop",
    model: "deepseek/deepseek-v4-flash",
    maxTurns: 3,
  },
};

const withKey = async () => {
  const secrets = createMemorySecretStore();
  await secrets.set("OPENROUTER_API_KEY", "sk-test");
  return secrets;
};

const drain = async (
  events: AsyncIterable<TestRunEvent> | undefined,
): Promise<TestRunEvent[]> => {
  const seen: TestRunEvent[] = [];
  for await (const event of events ?? []) seen.push(event);
  return seen;
};

describe("test runs", () => {
  it("does not start without the OpenRouter key", async () => {
    let called = false;
    const runs = createTestRuns({
      secrets: createMemorySecretStore(),
      dataDir: "/data",
      run: createFakeRun(() => {
        called = true;
        return Promise.resolve(finishedResult("stop"));
      }),
    });

    expect(await runs.start(DEFINITION, "hi")).toEqual({
      ok: false,
      missingSecret: "OPENROUTER_API_KEY",
    });
    expect(called).toBe(false);
  });

  it("runs the input and ends with the reason, usage and trace path", async () => {
    let sent: unknown;
    const runs = createTestRuns({
      secrets: await withKey(),
      dataDir: "/data",
      run: createFakeRun(({ messages, options }) => {
        sent = messages;
        options.onEvent?.({ type: "text-delta", delta: "pong" });
        return Promise.resolve(
          finishedResult("stop", { inputTokens: 12, outputTokens: 3 }),
        );
      }),
    });

    const started = await runs.start(DEFINITION, "ping");
    if (!started.ok) throw new Error("expected a started run");
    const seen = await drain(runs.watch(started.runId));

    expect(sent).toEqual([{ role: "user", content: "ping" }]);
    expect(seen).toEqual([
      {
        type: "harness",
        event: { type: "text-delta", delta: "pong" },
      },
      {
        type: "ended",
        reason: "stop",
        usage: { inputTokens: 12, outputTokens: 3 },
        tracePath: `/data/traces/${started.runId}.jsonl`,
      },
    ]);
    expect(await drain(runs.watch(started.runId))).toEqual(seen);
  });

  it("ends as stopped when the run is stopped while it goes", async () => {
    const runs = createTestRuns({
      secrets: await withKey(),
      dataDir: "/data",
      run: createFakeRun(({ options }) => {
        options.onEvent?.({ type: "text-delta", delta: "1\n" });
        return untilAborted(options.signal);
      }),
    });

    const started = await runs.start(DEFINITION, "count");
    if (!started.ok) throw new Error("expected a started run");

    expect(runs.stop(started.runId)).toBe(true);
    const seen = await drain(runs.watch(started.runId));

    expect(seen.map((event) => event.type)).toEqual([
      "harness",
      "stopped",
    ]);
    expect(runs.stop(started.runId)).toBe(false);
  });

  it("ends as stopped when the run wraps up on stop", async () => {
    const runs = createTestRuns({
      secrets: await withKey(),
      dataDir: "/data",
      run: createFakeRun(
        ({ options }) =>
          new Promise((resolve) => {
            options.onEvent?.({ type: "text-delta", delta: "1\n" });
            options.wrapUp?.addEventListener("abort", () => {
              resolve(finishedResult("wrapped-up"));
            });
          }),
      ),
    });

    const started = await runs.start(DEFINITION, "count");
    if (!started.ok) throw new Error("expected a started run");

    expect(runs.stop(started.runId)).toBe(true);
    const seen = await drain(runs.watch(started.runId));

    expect(seen.map((event) => event.type)).toEqual([
      "harness",
      "stopped",
    ]);
  });

  it("returns false when stopping a run that does not exist", async () => {
    const runs = createTestRuns({
      secrets: await withKey(),
      dataDir: "/data",
    });

    expect(runs.stop("nope")).toBe(false);
    expect(runs.watch("nope")).toBeUndefined();
  });

  it("keeps a run that failed and shows the error message", async () => {
    const runs = createTestRuns({
      secrets: await withKey(),
      dataDir: "/data",
      run: createFakeRun(() => Promise.reject(new Error("HTTP 401"))),
    });

    const started = await runs.start(DEFINITION, "hi");
    if (!started.ok) throw new Error("expected a started run");

    expect(await drain(runs.watch(started.runId))).toEqual([
      {
        type: "failed",
        message: "HTTP 401",
        tracePath: expect.stringMatching(/\.jsonl$/) as string,
      },
    ]);
  });

  it("fails the run when the judge is asked of a provider that cannot run it", async () => {
    const runs = createTestRuns({
      secrets: createMemorySecretStore(),
      dataDir: "/data",
    });

    const started = await runs.start(
      {
        ...DEFINITION,
        provider: { kind: "ollama" },
        means: {
          root: "/tmp",
          tools: ["read_file"],
          rules: [],
          judge: { model: "llama3", instruction: "Refuse deletes." },
        },
      },
      "hi",
    );
    if (!started.ok) throw new Error("expected a started run");

    const seen = await drain(runs.watch(started.runId));
    expect(seen).toEqual([
      {
        type: "failed",
        message:
          "判定 LLM は、このプロバイダでは使えません。ツール呼び出しを強制できるプロバイダ（OpenRouter）を選んでください",
        tracePath: expect.stringMatching(/\.jsonl$/) as string,
      },
    ]);
  });
});
