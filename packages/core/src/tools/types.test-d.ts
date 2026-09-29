import type { Reach, Tool, ToolSchema } from "./types.js";

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

export const pathWithoutExtent: Reach = {
  kind: "paths",
  // @ts-expect-error a paths entry needs an extent
  paths: [{ path: "/a" }],
};

export const bareStringPath: Reach = {
  kind: "paths",
  // @ts-expect-error a paths entry is a path with an extent, not a string
  paths: ["/a"],
};
