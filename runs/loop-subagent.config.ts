// 書き方は packages/runner/agent-guide.md を見てください。
import { readFileSync } from "node:fs";
import { defineRun } from "@mg/runner";
import { createOpenRouterProvider } from "@mg/core";
import { createLlmGate, createRulesGate } from "@mg/gate";
import {
  createCdpConnector,
  createSshConnector,
  createSshEndpoint,
  defineWorkspace,
} from "@mg/workspace";
import { outputPath } from "./outputs.ts";

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

const readPort = (name: string): number => {
  const raw = process.env[name];
  if (raw === undefined) throw new Error(`${name} is not set`);
  if (!/^[0-9]+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535)
    throw new Error(
      `${name} must be an integer from 1 to 65535: ${JSON.stringify(raw)}`,
    );
  return Number(raw);
};

const sshConnection = {
  host: sshHost,
  username: sshUser,
  auth: { privateKey: readFileSync(sshKeyPath, "utf8") },
};

const cdpPort = readPort("MG_CDP_PORT");
const cleanCdpPort = readPort("MG_CLEAN_CDP_PORT");

const provider = createOpenRouterProvider({ apiKey });

const buildMachine = defineWorkspace({
  name: "build-machine",
  connectors: [
    createSshConnector(sshConnection),
    createCdpConnector({
      endpoint: createSshEndpoint({
        ...sshConnection,
        remotePort: cdpPort,
      }),
    }),
  ],
});

const cleanBrowser = defineWorkspace({
  name: "clean-browser",
  connectors: [
    createCdpConnector({
      endpoint: createSshEndpoint({
        ...sshConnection,
        remotePort: cleanCdpPort,
      }),
    }),
  ],
});

export default defineRun({
  name: "loop-subagent-deepseek-endpoint",
  provider,
  harness: {
    kind: "loop",
    model: "deepseek/deepseek-v4-flash",
    maxTurns: 10,
  },
  workspace: buildMachine,
  gate: createLlmGate({
    provider,
    model: "deepseek/deepseek-v4-flash",
    policy:
      "Calling the researcher subagent is allowed. Reading files " +
      "and browsing pages are allowed. Changing files, installing " +
      "software, or typing into forms is not.",
  }),
  subagents: [
    {
      name: "researcher",
      description:
        "Researches a topic in a browser and reports what it finds.",
      provider,
      harness: {
        kind: "loop",
        model: "deepseek/deepseek-v4-flash",
        maxTurns: 10,
      },
      gate: createRulesGate({
        root: process.cwd(),
        rules: [
          {
            tools: ["browser_type"],
            allowed: false,
            reason:
              "Typing into forms is not allowed while researching.",
          },
        ],
      }),
      workspace: {
        pick: "caller",
        sources: [
          { kind: "parent" },
          { kind: "own", workspace: cleanBrowser },
        ],
        required: true,
      },
    },
  ],
  trace: { jsonlPath: outputPath("trace.jsonl") },
});
