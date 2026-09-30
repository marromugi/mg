import type { RunConfig } from "./config.js";
import { GateRequiredError } from "./errors.js";
import type { SubagentConfig } from "./subagent-config.js";

export const requireSubagentGate = (config: SubagentConfig): void => {
  if (
    config.gate === undefined &&
    (config.tools !== undefined || config.workspace !== undefined)
  ) {
    throw new GateRequiredError({ subagent: config.name });
  }
};

export const requireGates = (
  config: RunConfig,
  addedTools: unknown,
): void => {
  if (config.gate === undefined) {
    if (config.tools !== undefined || config.workspace !== undefined) {
      throw new GateRequiredError("means");
    }
    if (addedTools !== undefined) {
      throw new GateRequiredError("added-tools");
    }
  }
  for (const subagent of config.subagents ?? []) {
    requireSubagentGate(subagent);
  }
};
