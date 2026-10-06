import type { HarnessDefinition } from "../definition/index.js";
import {
  draftFromDefinition,
  emptyDraft,
} from "../harness-form/index.js";

export const filesHarness: HarnessDefinition = {
  id: "0b1c2d3e",
  name: "files",
  provider: { kind: "openrouter" },
  harness: {
    kind: "loop",
    model: "deepseek/deepseek-v4-flash",
    maxTurns: 10,
  },
  means: {
    root: "/Users/me/work",
    tools: ["read_file", "grep"],
    rules: [
      {
        paths: [".env"],
        allowed: false,
        reason: "Secrets stay private.",
      },
    ],
  },
};

export const judgedHarness: HarnessDefinition = {
  id: "4f5a6b7c",
  name: "reviewer",
  provider: { kind: "ollama", baseUrl: "http://localhost:11434" },
  harness: { kind: "loop", model: "llama3", maxTurns: 20 },
  means: {
    root: "/Users/me/work",
    tools: ["bash", "write_file"],
    rules: [],
    judge: {
      model: "llama3",
      instruction: "Refuse anything that deletes files.",
    },
  },
};

export const chatHarness: HarnessDefinition = {
  id: "8d9e0f1a",
  name: "chat",
  provider: { kind: "openrouter" },
  harness: { kind: "loop", model: "openai/gpt-5", maxTurns: 5 },
};

export const newDraft = emptyDraft();
export const filesDraft = draftFromDefinition(filesHarness);
export const judgedDraft = draftFromDefinition(judgedHarness);
