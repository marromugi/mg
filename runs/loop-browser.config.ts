// 書き方は packages/runner/agent-guide.md を見てください。
import { mkdirSync } from "node:fs";
import { defineRun } from "@mg/runner";
import { createOpenRouterProvider } from "@mg/core";
import { createLlmGate } from "@mg/gate";
import { createGrepTool, createReadFileTool } from "@mg/tools";
import { createCdpConnector, defineWorkspace } from "@mg/workspace";
import { llmGateInstruction } from "./llm-gate-instruction.ts";
import { outputPath } from "./outputs.ts";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const provider = createOpenRouterProvider({ apiKey });

// Where the page texts that browser_read cuts are saved. The file tools
// need the directory to exist.
const browserOutputDir = outputPath("browser-output");
mkdirSync(browserOutputDir, { recursive: true });

export default defineRun({
  name: "loop-browser-deepseek-local",
  provider,
  tools: [
    createReadFileTool({
      root: browserOutputDir,
      maxOutputChars: 16000,
    }),
    createGrepTool({ root: browserOutputDir }),
  ],
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
        overflowDir: browserOutputDir,
      }),
    ],
  }),
  gate: createLlmGate({
    provider,
    model: "deepseek/deepseek-v4-flash",
    instruction: llmGateInstruction(
      "Moving to a page and reading it are allowed. Reading and " +
        "searching the files where page texts are saved is allowed. " +
        "Clicking, typing into forms, or submitting anything is not.",
    ),
  }),
  trace: { jsonlPath: outputPath("trace.jsonl") },
});
