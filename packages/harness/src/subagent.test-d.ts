import type { ToolSchema } from "@mg/core";
import type { Subagent } from "./subagent.js";

declare const input: ToolSchema;

const withoutReach = {
  name: "s",
  input,
  start: async () => "done",
};

const withReach = {
  name: "s",
  input,
  reach: async () => ({ kind: "none" as const }),
  start: async () => "done",
};

// @ts-expect-error a subagent needs a reach declaration
export const subagentWithoutReach: Subagent = withoutReach;

export const subagentWithReach: Subagent = withReach;
