// 書き方は packages/runner/agent-guide.md を見てください。
import { defineRun } from "@mg/runner";
import { createOpenRouterProvider } from "@mg/core";
import {
  createBashTool,
  createReadFileTool,
  createGrepTool,
  createWriteFileTool,
  createEditFileTool,
} from "@mg/tools";
import { createRulesGate } from "@mg/gate";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const root = process.cwd();

export default defineRun({
  name: "loop-files",
  provider: createOpenRouterProvider({ apiKey }),
  harness: { kind: "loop", model: "openai/gpt-4o-mini", maxTurns: 10 },
  tools: [
    createBashTool({ cwd: root }),
    createReadFileTool({ root }),
    createGrepTool({ root }),
    createWriteFileTool({ root }),
    createEditFileTool({ root }),
  ],
  gate: createRulesGate({
    root,
    rules: [
      {
        tools: ["write_file", "edit_file"],
        paths: ["**/.env", "**/.env.*", "**/*.lock", ".git/**"],
        allowed: false,
        reason:
          "Secrets, lockfiles and .git are read-only for the agent.",
      },
    ],
  }),
  trace: { jsonlPath: "./trace.jsonl" },
});
