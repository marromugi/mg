import type { Provider, Tool } from "@mg/core";
import type { Gate } from "@mg/gate";
import type { Subagent } from "@mg/harness";
import type { HarnessConfig } from "./config.js";
import { createHarness } from "./harness.js";

declare const provider: Provider;
declare const harnessConfig: HarnessConfig;
declare const gate: Gate;
declare const tool: Tool;
declare const subagent: Subagent;

export const toolsWithoutGate = createHarness(
  harnessConfig,
  provider,
  // @ts-expect-error tools with no gate fails the type check
  { tools: [tool] },
);

export const emptyToolsWithoutGate = createHarness(
  harnessConfig,
  provider,
  // @ts-expect-error an empty tools list still needs a gate
  { tools: [] },
);

export const gateAndTools = createHarness(harnessConfig, provider, {
  gate,
  tools: [tool],
});
export const gateOnly = createHarness(harnessConfig, provider, {
  gate,
});
export const subagentsOnly = createHarness(harnessConfig, provider, {
  subagents: [subagent],
});
export const nothing = createHarness(harnessConfig, provider, {});
