// 書き方は packages/runner/agent-guide.md を見てください。
import { defineRun, type RunConfig } from "@mg/runner";
import {
  createOpenRouterProvider,
  type Provider,
  type ToolForcingProvider,
} from "@mg/core";
import {
  createBashTool,
  createReadFileTool,
  createGrepTool,
  createWriteFileTool,
  createEditFileTool,
} from "@mg/tools";
import { composeGates, createLlmGate, createRulesGate } from "@mg/gate";
import { outputPath } from "./outputs.ts";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

export type LoopFilesRunOptions = {
  provider: Provider;
  gateProvider: ToolForcingProvider;
  root: string;
  trace?: RunConfig["trace"];
};

export const buildLoopFilesRun = ({
  provider,
  gateProvider,
  root,
  trace,
}: LoopFilesRunOptions) =>
  defineRun({
    name: "loop-files-deepseek-composed",
    provider,
    harness: {
      kind: "loop",
      model: "deepseek/deepseek-v4-flash",
      maxTurns: 10,
    },
    tools: [
      createBashTool({ cwd: root }),
      createReadFileTool({ root }),
      createGrepTool({ root }),
      createWriteFileTool({ root }),
      createEditFileTool({ root }),
    ],
    gate: composeGates([
      createRulesGate({
        root,
        rules: [
          {
            tools: [
              "read_file",
              "grep",
              "write_file",
              "edit_file",
              "bash",
            ],
            paths: [
              "**/.env",
              "**/.env.*",
              "**/*.lock",
              ".git/**",
              ".git",
            ],
            allowed: false,
            reason:
              "Secrets, lockfiles and .git are off limits for the agent.",
          },
        ],
      }),
      createLlmGate({
        provider: gateProvider,
        model: "deepseek/deepseek-v4-flash",
        policy:
          "Reading and editing project files is allowed. Reading or " +
          "changing secrets (.env files), lockfiles or anything under " +
          ".git is not. Running shell commands is not.",
      }),
    ]),
    trace,
  });

const openRouter = createOpenRouterProvider({ apiKey });

export default buildLoopFilesRun({
  provider: openRouter,
  gateProvider: openRouter,
  root: process.cwd(),
  trace: { jsonlPath: outputPath("trace.jsonl") },
});
