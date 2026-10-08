import { createJevEstimator } from "@mg/core";
import { describe, expect, it } from "vitest";
import type { HarnessDefinition } from "../definition/index.js";
import { createMemorySecretStore } from "../test/memory-secret-store.js";
import { assemble } from "./index.js";

const CHAT: HarnessDefinition = {
  id: "h1",
  name: "chat",
  provider: { kind: "openrouter" },
  harness: { kind: "loop", model: "m", maxTurns: 3 },
};

const withKey = async () => {
  const secrets = createMemorySecretStore();
  await secrets.set("OPENROUTER_API_KEY", "sk-test");
  return secrets;
};

describe("assemble", () => {
  it("names the missing OpenRouter key", async () => {
    const result = await assemble(CHAT, {
      secrets: createMemorySecretStore(),
      tracePath: "/t/r.jsonl",
    });

    expect(result).toEqual({
      ok: false,
      missingSecret: "OPENROUTER_API_KEY",
    });
  });

  it("builds a run without tools or gate from a harness without means", async () => {
    const result = await assemble(CHAT, {
      secrets: await withKey(),
      tracePath: "/t/r.jsonl",
    });

    if (!result.ok) throw new Error("expected a config");
    expect(result.config.name).toBe("chat");
    expect(result.config.harness).toEqual(CHAT.harness);
    expect(result.config.trace).toEqual({ jsonlPath: "/t/r.jsonl" });
    expect(result.config.tools).toBeUndefined();
    expect(result.config.gate).toBeUndefined();
  });

  it("builds the chosen tools and a gate from the means", async () => {
    const result = await assemble(
      {
        ...CHAT,
        means: {
          root: "/tmp",
          tools: ["read_file", "grep"],
          rules: [{ paths: ["**"], allowed: true }],
        },
      },
      { secrets: await withKey(), tracePath: "/t/r.jsonl" },
    );

    if (!result.ok) throw new Error("expected a config");
    expect(result.config.tools?.map((tool) => tool.name)).toEqual([
      "read_file",
      "grep",
    ]);
    expect(result.config.gate).toBeDefined();
  });

  const GATED: HarnessDefinition = {
    ...CHAT,
    means: {
      root: "/tmp",
      tools: ["bash"],
      rules: [],
      gate: { question: "Does this stay inside the folder?" },
    },
  };

  it("does not build a harness with a gate when the server has no key for Jev", async () => {
    await expect(
      assemble(GATED, {
        secrets: await withKey(),
        tracePath: "/t/r.jsonl",
      }),
    ).rejects.toThrow("TYPESAFE_API_KEY");
  });

  it("builds a gate for a harness guarded by the gate alone", async () => {
    const result = await assemble(GATED, {
      secrets: await withKey(),
      tracePath: "/t/r.jsonl",
      jev: createJevEstimator({ apiKey: "tk-test" }),
    });

    if (!result.ok) throw new Error("expected a config");
    expect(result.config.gate).toBeDefined();
  });
});
