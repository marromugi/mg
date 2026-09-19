// 書き方は packages/runner/agent-guide.md を見てください。
import { defineRun } from "@mg/runner";
import { createJevEstimator, createOpenRouterProvider } from "@mg/core";
import { createBashTool } from "@mg/tools";
import { createEstimatorGate } from "@mg/gate";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const jevApiKey = process.env.TYPESAFE_API_KEY;
if (jevApiKey === undefined)
  throw new Error("TYPESAFE_API_KEY is not set");

const provider = createOpenRouterProvider({ apiKey });

const policy =
  "Read-only commands are allowed. Deleting files or " +
  "sending data outside the machine is not.";

export default defineRun({
  name: "loop-bash-jev-gate",
  provider,
  harness: { kind: "loop", model: "openai/gpt-4o-mini", maxTurns: 10 },
  tools: [createBashTool({ cwd: process.cwd() })],
  gate: createEstimatorGate({
    estimator: createJevEstimator({ apiKey: jevApiKey }),
    policy,
  }),
  trace: { jsonlPath: "./trace.jsonl" },
});
