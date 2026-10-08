import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { getRequestListener } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";
import type { HarnessDefinition } from "../definition/index.js";
import { createFakeRun, untilAborted } from "../test/fake-run.js";
import { createMemorySecretStore } from "../test/memory-secret-store.js";
import { createMemoryStore } from "../test/memory-store.js";
import { createTrials } from "../trial/index.js";
import { createApi } from "./api.js";

const LOCAL: HarnessDefinition = {
  id: "h1",
  name: "local",
  provider: { kind: "ollama" },
  harness: { kind: "loop", model: "llama3.3", maxTurns: 10 },
  system: "保存済みのプロンプト",
};

const closing: (() => void)[] = [];
afterEach(() => {
  for (const close of closing.splice(0)) close();
});

// The API on a real socket, so a response can be closed from outside.
const listen = async (run: ReturnType<typeof createFakeRun>) => {
  const store = createMemoryStore();
  await store.put(LOCAL);
  const api = createApi({
    definitions: store,
    trials: createTrials({
      secrets: createMemorySecretStore(),
      dataDir: "/unused",
      run,
    }),
  });
  const server = createServer(getRequestListener(api.fetch));
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  closing.push(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address() as AddressInfo;
  return (body: unknown, signal?: AbortSignal) =>
    fetch(`http://127.0.0.1:${port}/harnesses/h1/trial`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
};

describe("POST /harnesses/{id}/trial", () => {
  it("answers one line for each event, with the prompt the page sent", async () => {
    let system: unknown;
    const send = await listen(
      createFakeRun(async (call) => {
        system = call.messages[0];
        call.options.onEvent?.({ type: "text-delta", delta: "はい" });
        return {
          reason: "stop",
          usage: { inputTokens: 0, outputTokens: 0 },
          messages: call.messages,
        };
      }),
    );

    const response = await send({
      input: "いますか",
      system: "書きかけのプロンプト",
    });
    const lines = (await response.text()).trim().split("\n");

    expect(response.headers.get("Content-Type")).toBe(
      "application/x-ndjson; charset=utf-8",
    );
    expect(lines.map((line) => JSON.parse(line).type)).toEqual([
      "started",
      "text",
      "ended",
    ]);
    expect(system).toEqual({
      role: "system",
      content: "書きかけのプロンプト",
    });
  });

  it("stops the agent when the page closes the response", async () => {
    let stopped: () => void = () => {};
    const whenStopped = new Promise<void>((resolve) => {
      stopped = () => resolve();
    });
    const send = await listen(
      createFakeRun((call) => {
        call.options.signal?.addEventListener("abort", stopped);
        return untilAborted(call.options.signal);
      }),
    );
    const page = new AbortController();

    const response = await send(
      { input: "いますか", system: "" },
      page.signal,
    );
    await response.body?.getReader().read();
    page.abort();

    await expect(whenStopped).resolves.toBeUndefined();
  });

  it("answers 400 for a message with no input", async () => {
    const send = await listen(
      createFakeRun(() => untilAborted(undefined)),
    );

    const response = await send({ input: "", system: "" });

    expect(response.status).toBe(400);
  });
});
