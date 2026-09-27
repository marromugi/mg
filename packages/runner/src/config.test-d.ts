import type { Provider, Tool } from "@mg/core";
import type { Gate } from "@mg/gate";
import type { Workspace } from "@mg/workspace";
import type { HarnessConfig } from "./config.js";
import { defineRun } from "./config.js";

declare const provider: Provider;
declare const harness: HarnessConfig;
declare const gate: Gate;
declare const tool: Tool;
declare const workspace: Workspace;

export const toolsWithoutGate = defineRun({
  name: "a",
  provider,
  harness,
  // @ts-expect-error tools with no gate fails the type check
  tools: [tool],
});

export const emptyToolsWithoutGate = defineRun({
  name: "a",
  provider,
  harness,
  // @ts-expect-error an empty tools array still needs a gate
  tools: [],
});

export const workspaceWithoutGate = defineRun({
  name: "a",
  provider,
  harness,
  // @ts-expect-error workspace with no gate fails the type check
  workspace,
});

export const bareConfig = defineRun({ name: "a", provider, harness });

export const gatedConfig = defineRun({
  name: "a",
  provider,
  harness,
  gate,
});

export const gatedConfigWithTools = defineRun({
  name: "a",
  provider,
  harness,
  gate,
  tools: [tool],
});

const keptGate: Gate = gatedConfigWithTools.gate;
void keptGate;
