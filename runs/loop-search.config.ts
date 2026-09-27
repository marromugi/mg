// 書き方は packages/runner/agent-guide.md を見てください。
import { defineRun } from "@mg/runner";
import { createOpenRouterProvider } from "@mg/core";
import { createLlmGate } from "@mg/gate";
import {
  createBashTool,
  createWebSearchTool,
  createOllamaWebSearchBackend,
} from "@mg/tools";
import { outputPath } from "./outputs.ts";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const ollamaApiKey = process.env.OLLAMA_API_KEY;
if (ollamaApiKey === undefined)
  throw new Error("OLLAMA_API_KEY is not set");

const provider = createOpenRouterProvider({ apiKey });

export default defineRun({
  name: "loop-search-deepseek",
  provider,
  harness: {
    kind: "loop",
    model: "deepseek/deepseek-v4-flash",
    maxTurns: 10,
  },
  tools: [
    createBashTool({ cwd: process.cwd() }),
    createWebSearchTool({
      backend: createOllamaWebSearchBackend({ apiKey: ollamaApiKey }),
    }),
  ],
  gate: createLlmGate({
    provider,
    model: "deepseek/deepseek-v4-flash",
    policy:
      "Read-only commands and web searches are allowed. Deleting " +
      "files or sending data outside the machine is not.",
  }),
  trace: { jsonlPath: outputPath("trace.jsonl") },
});
