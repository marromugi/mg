import type { Provider, Tool } from "@mg/core";
import type { Gate } from "@mg/gate";
import type { Subagent } from "@mg/harness";
import { createLoopHarness } from "./loop.js";

declare const provider: Provider;
declare const gate: Gate;
declare const tool: Tool;
declare const subagent: Subagent;

const base = { provider, model: "m", maxTurns: 1 };

export const toolsWithoutGate = createLoopHarness(
  // @ts-expect-error tools with no gate fails the type check
  { ...base, tools: [tool] },
);

export const emptyToolsWithoutGate = createLoopHarness(
  // @ts-expect-error an empty tools list still needs a gate
  { ...base, tools: [] },
);

export const gateAndTools = createLoopHarness({
  ...base,
  gate,
  tools: [tool],
});
export const gateOnly = createLoopHarness({ ...base, gate });
export const subagentsOnly = createLoopHarness({
  ...base,
  subagents: [subagent],
});
export const nothing = createLoopHarness(base);
