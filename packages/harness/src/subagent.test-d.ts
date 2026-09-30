import type { ToolSchema } from "@mg/core";
import type { Subagent } from "./subagent.js";

declare const input: ToolSchema;

const prepare = async () => ({
  reach: { kind: "none" as const },
  run: async () => "done",
});

export const subagentWithPrepare: Subagent = {
  name: "s",
  input,
  prepare,
};

export const subagentWithReach: Subagent = {
  name: "s",
  input,
  prepare,
  // @ts-expect-error a subagent declares its reach through prepare, not itself
  reach: async () => ({ kind: "none" as const }),
};

export const subagentWithStart: Subagent = {
  name: "s",
  input,
  prepare,
  // @ts-expect-error a subagent acts through prepare, not start
  start: async () => "done",
};
