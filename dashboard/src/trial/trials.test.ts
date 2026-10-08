import { describe, expect, it } from "vitest";
import type { HarnessDefinition } from "../definition/index.js";
import {
  createFakeRun,
  untilAborted,
  type FakeRunCall,
} from "../test/fake-run.js";
import { createMemorySecretStore } from "../test/memory-secret-store.js";
import type { TrialEvent } from "./events.js";
import { createTrials, type Trials } from "./trials.js";

const LOCAL: HarnessDefinition = {
  id: "h1",
  name: "local",
  provider: { kind: "ollama" },
  harness: { kind: "loop", model: "llama3.3", maxTurns: 10 },
  system: "短く答えてください。",
};

const USAGE = { inputTokens: 0, outputTokens: 0 };

// A run that answers every message with "はい".
const answering = (calls: FakeRunCall[]) =>
  createFakeRun(async (call) => {
    calls.push(call);
    call.options.onEvent?.({ type: "text-delta", delta: "はい" });
    return {
      reason: "stop",
      usage: USAGE,
      messages: [
        ...call.messages,
        { role: "assistant", parts: [{ type: "text", text: "はい" }] },
      ],
    };
  });

const open = (run: ReturnType<typeof createFakeRun>): Trials =>
  createTrials({
    secrets: createMemorySecretStore(),
    dataDir: "/unused",
    run,
  });

const all = async (
  events: AsyncIterable<TrialEvent>,
): Promise<TrialEvent[]> => {
  const seen: TrialEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
};

describe("send", () => {
  it("starts a conversation and gives the answer as it comes", async () => {
    const events = await all(
      open(answering([])).send(LOCAL, "いますか"),
    );

    expect(events).toEqual([
      { type: "started", conversationId: expect.any(String) },
      { type: "text", delta: "はい" },
      { type: "ended" },
    ]);
  });

  it("continues a conversation with what was said before", async () => {
    const calls: FakeRunCall[] = [];
    const trials = open(answering(calls));
    const [started] = await all(trials.send(LOCAL, "いますか"));
    const conversationId =
      started?.type === "started" ? started.conversationId : "";

    await all(trials.send(LOCAL, "本当に", { conversationId }));

    expect(calls[1]?.messages).toEqual([
      { role: "system", content: "短く答えてください。" },
      { role: "user", content: "いますか" },
      { role: "assistant", parts: [{ type: "text", text: "はい" }] },
      { role: "user", content: "本当に" },
    ]);
  });

  it("fails for a conversation it does not hold", async () => {
    const events = await all(
      open(answering([])).send(LOCAL, "いますか", {
        conversationId: "gone",
      }),
    );

    expect(events).toEqual([
      {
        type: "failed",
        message:
          "この会話はもう残っていません。新しい会話を始めてください",
      },
    ]);
  });

  it("fails with the name of the key the provider needs", async () => {
    const events = await all(
      open(answering([])).send(
        { ...LOCAL, provider: { kind: "openrouter" } },
        "いますか",
      ),
    );

    expect(events).toEqual([
      {
        type: "failed",
        message: "OPENROUTER_API_KEY が設定されていません",
      },
    ]);
  });

  it("gives the reason when the run fails", async () => {
    const trials = open(
      createFakeRun(() =>
        Promise.reject(new Error("connection refused")),
      ),
    );

    const events = await all(trials.send(LOCAL, "いますか"));

    expect(events.at(-1)).toEqual({
      type: "failed",
      message: "connection refused",
    });
  });

  it("ends the events when the answer is cut short", async () => {
    const stop = new AbortController();
    const trials = open(
      createFakeRun((call) => untilAborted(call.options.signal)),
    );

    const events = trials.send(LOCAL, "いますか", {
      signal: stop.signal,
    });
    const seen: TrialEvent[] = [];
    for await (const event of events) {
      seen.push(event);
      stop.abort();
    }

    expect(seen).toEqual([
      { type: "started", conversationId: expect.any(String) },
    ]);
  });
});
