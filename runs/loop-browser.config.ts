// 書き方は packages/runner/agent-guide.md を見てください。
import { defineRun } from "@mg/runner";
import { createOpenRouterProvider } from "@mg/core";
import { createLlmGate } from "@mg/gate";
import { createCdpConnector, defineWorkspace } from "@mg/workspace";
import { llmGateInstruction } from "./llm-gate-instruction.ts";
import { outputPath } from "./outputs.ts";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const provider = createOpenRouterProvider({ apiKey });

export default defineRun({
  name: "loop-browser-deepseek-local",
  provider,
  harness: {
    kind: "loop",
    model: "deepseek/deepseek-v4-flash",
    maxTurns: 10,
  },
  workspace: defineWorkspace({
    name: "local-browser",
    connectors: [
      createCdpConnector({
        browser: "localhost:9222",
        url: "http://localhost:9222",
      }),
    ],
  }),
  gate: createLlmGate({
    provider,
    model: "deepseek/deepseek-v4-flash",
    instruction: llmGateInstruction(
      "Moving to a page and reading it are allowed. Clicking, " +
        "typing into forms, or submitting anything is not.",
    ),
  }),
  trace: { jsonlPath: outputPath("trace.jsonl") },
});
