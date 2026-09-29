import type { Tool, ToolSchema } from "./types.js";

declare const input: ToolSchema;

const withoutReach = {
  name: "t",
  input,
  execute: async () => "done",
};

const withReach = {
  name: "t",
  input,
  reach: async () => ({ kind: "any-local" as const }),
  execute: async () => "done",
};

// @ts-expect-error a tool needs a reach declaration
export const toolWithoutReach: Tool = withoutReach;

export const toolWithReach: Tool = withReach;
