import { describe, expect, it } from "vitest";
import type { HarnessDefinition } from "../../../../definition/index.js";
import { useRows } from "./useRows.js";

const CHAT: HarnessDefinition = {
  id: "h1",
  name: "chat",
  provider: { kind: "openrouter" },
  harness: { kind: "loop", model: "openai/gpt-4o", maxTurns: 10 },
};

describe("useRows", () => {
  it("shows an agent with no tools as it was saved", () => {
    expect(useRows([{ ...CHAT, avatar: "a1" }])).toEqual([
      {
        id: "h1",
        name: "chat",
        seed: "a1",
        href: "/harnesses/h1",
        provider: "OpenRouter",
        model: "openai/gpt-4o",
        tools: [],
        guards: [],
      },
    ]);
  });

  it("draws the face from the name when none was saved", () => {
    expect(useRows([CHAT])[0]?.seed).toBe("chat");
  });

  it("names each guard in front of the tools", () => {
    const [row] = useRows([
      {
        ...CHAT,
        provider: { kind: "ollama" },
        means: {
          root: "/work",
          tools: ["read_file", "bash"],
          rules: [{ paths: ["src/**"], allowed: true }],
          judge: { model: "j", instruction: "Refuse deletes." },
          gate: { question: "Does this stay inside the folder?" },
        },
      },
    ]);

    expect([row?.provider, row?.tools, row?.guards]).toEqual([
      "Ollama",
      ["read_file", "bash"],
      ["パス", "判定 LLM", "ゲート"],
    ]);
  });

  it("leaves out the guard of paths when there is no rule", () => {
    const [row] = useRows([
      {
        ...CHAT,
        means: {
          root: "/work",
          tools: ["bash"],
          rules: [],
          gate: { question: "Does this stay inside the folder?" },
        },
      },
    ]);

    expect(row?.guards).toEqual(["ゲート"]);
  });
});
