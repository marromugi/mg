// 書き方は packages/runner/agent-guide.md を見てください。
import { readFileSync } from "node:fs";
import { defineRun } from "@mg/runner";
import { createOpenRouterProvider } from "@mg/core";
import {
  createCdpConnector,
  createSshConnector,
  defineWorkspace,
} from "@mg/workspace";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const sshHost = process.env.MG_SSH_HOST;
if (sshHost === undefined) throw new Error("MG_SSH_HOST is not set");

const sshUser = process.env.MG_SSH_USER;
if (sshUser === undefined) throw new Error("MG_SSH_USER is not set");

const sshKeyPath = process.env.MG_SSH_KEY_PATH;
if (sshKeyPath === undefined)
  throw new Error("MG_SSH_KEY_PATH is not set");

const cdpUrl = process.env.MG_CDP_URL;
if (cdpUrl === undefined) throw new Error("MG_CDP_URL is not set");

export default defineRun({
  name: "loop-workspace",
  provider: createOpenRouterProvider({ apiKey }),
  harness: { kind: "loop", model: "openai/gpt-4o-mini", maxTurns: 10 },
  workspace: defineWorkspace({
    name: "build-machine",
    connectors: [
      createSshConnector({
        host: sshHost,
        username: sshUser,
        auth: { privateKey: readFileSync(sshKeyPath, "utf8") },
      }),
      createCdpConnector({ url: cdpUrl }),
    ],
  }),
  trace: { jsonlPath: "./trace.jsonl" },
});
