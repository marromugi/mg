import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { HarnessDefinition } from "../definition/index.js";
import { createMemoryStore } from "../test/memory-store.js";
import { registerHarnesses } from "./harnesses.js";

const CHAT: HarnessDefinition = {
  id: "h1",
  name: "chat",
  provider: { kind: "ollama" },
  harness: { kind: "loop", model: "llama3.3", maxTurns: 10 },
  system: "短く答えてください。",
};

const open = async (
  options: Parameters<typeof createMemoryStore>[0] = {},
) => {
  const store = createMemoryStore();
  await store.put(CHAT);
  const app = new Hono();
  registerHarnesses(
    app,
    options.listFailsWith === undefined
      ? store
      : createMemoryStore(options),
  );
  return app;
};

describe("harness pages", () => {
  it("lists the saved agents with a link to each", async () => {
    const response = await (await open()).request("/harnesses");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('href="/harnesses/h1"');
  });

  it("draws the list page with the reason when the list cannot be read", async () => {
    const app = await open({
      listFailsWith: "ENOTDIR: not a directory",
    });

    const response = await app.request("/harnesses");

    expect(response.status).toBe(500);
    expect(await response.text()).toContain("ENOTDIR: not a directory");
  });

  it("shows one agent with its prompt and the box to try it from", async () => {
    const response = await (await open()).request("/harnesses/h1");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("短く答えてください。");
    expect(html).toContain("メッセージを書く");
  });

  it("answers 404 for an agent that is not saved", async () => {
    const response = await (await open()).request("/harnesses/none");

    expect(response.status).toBe(404);
  });
});
