// 書き方は packages/runner/agent-guide.md を見てください。
import { defineRun } from "@mg/runner";
import { createOpenRouterProvider } from "@mg/core";
import { createBashTool } from "@mg/tools";
import { createLlmGate } from "@mg/gate";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const provider = createOpenRouterProvider({ apiKey });

export default defineRun({
  name: "loop-bash-gate-deepseek",
  provider,
  harness: {
    kind: "loop",
    model: "deepseek/deepseek-v4-flash",
    maxTurns: 10,
  },
  tools: [createBashTool({ cwd: process.cwd() })],
  gate: createLlmGate({
    provider,
    model: "deepseek/deepseek-v4-flash",
    policy:
      "Read-only commands are allowed. Deleting files or " +
      "sending data outside the machine is not.",
  }),
  trace: { jsonlPath: "./trace.jsonl" },
});
