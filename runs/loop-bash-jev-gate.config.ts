// 書き方は packages/runner/agent-guide.md を見てください。
import { defineRun } from "@mg/runner";
import { createOpenRouterProvider } from "@mg/core";
import { createBashTool } from "@mg/tools";
import { createEstimatorGate } from "@mg/gate";
import { createSampleJevEstimator } from "./jev-estimator.ts";
import { bashReadOnlyPolicy } from "./bash-policy.ts";
import { outputPath } from "./outputs.ts";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const jevApiKey = process.env.TYPESAFE_API_KEY;
if (jevApiKey === undefined)
  throw new Error("TYPESAFE_API_KEY is not set");

const provider = createOpenRouterProvider({ apiKey });

export default defineRun({
  name: "loop-bash-jev-gate-deepseek",
  provider,
  harness: {
    kind: "loop",
    model: "deepseek/deepseek-v4-flash",
    maxTurns: 10,
  },
  tools: [createBashTool({ cwd: process.cwd() })],
  gate: createEstimatorGate({
    estimator: createSampleJevEstimator({ apiKey: jevApiKey }),
    policy: bashReadOnlyPolicy,
  }),
  trace: { jsonlPath: outputPath("trace.jsonl") },
});
