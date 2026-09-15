// 書き方は packages/runner/agent-guide.md を見てください。
import { defineRun } from "@mg/runner";
import { createOpenRouterProvider } from "@mg/core";
import { createBashTool } from "@mg/tools";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

export default defineRun({
  name: "loop-bash",
  provider: createOpenRouterProvider({ apiKey }),
  harness: { kind: "loop", model: "openai/gpt-4o-mini", maxTurns: 10 },
  tools: [createBashTool({ cwd: process.cwd() })],
  trace: { jsonlPath: "./trace.jsonl" },
});
