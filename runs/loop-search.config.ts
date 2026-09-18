// 書き方は packages/runner/agent-guide.md を見てください。
import { defineRun } from "@mg/runner";
import { createOpenRouterProvider } from "@mg/core";
import {
  createBashTool,
  createWebSearchTool,
  createOllamaWebSearchBackend,
} from "@mg/tools";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const ollamaApiKey = process.env.OLLAMA_API_KEY;
if (ollamaApiKey === undefined)
  throw new Error("OLLAMA_API_KEY is not set");

export default defineRun({
  name: "loop-search",
  provider: createOpenRouterProvider({ apiKey }),
  harness: { kind: "loop", model: "openai/gpt-4o-mini", maxTurns: 10 },
  tools: [
    createBashTool({ cwd: process.cwd() }),
    createWebSearchTool({
      backend: createOllamaWebSearchBackend({ apiKey: ollamaApiKey }),
    }),
  ],
  trace: { jsonlPath: "./trace.jsonl" },
});
