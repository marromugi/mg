import type { Reach, Tool, ToolSchema } from "./types.js";

declare const input: ToolSchema;

const prepare = async () => ({
  reach: { kind: "any-local" as const },
  run: async () => "done",
});

export const toolWithPrepare: Tool = { name: "t", input, prepare };

// @ts-expect-error a tool needs a prepare
export const toolWithoutPrepare: Tool = { name: "t", input };

export const toolWithReach: Tool = {
  name: "t",
  input,
  prepare,
  // @ts-expect-error a tool declares its reach through prepare, not itself
  reach: async () => ({ kind: "any-local" as const }),
};

export const toolWithExecute: Tool = {
  name: "t",
  input,
  prepare,
  // @ts-expect-error a tool acts through prepare, not execute
  execute: async () => "done",
};

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
