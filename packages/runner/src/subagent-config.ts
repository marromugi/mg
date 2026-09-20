import type { Provider, Tool } from "@mg/core";
import type { Gate } from "@mg/gate";
import type { Workspace } from "@mg/workspace";
import type { HarnessConfig } from "./config.js";

export type SubagentBase = {
  name: string;
  description: string;
  system?: string;
  provider: Provider;
  harness: HarnessConfig;
};

export type SubagentWorkspaceSource =
  { kind: "parent" } | { kind: "own"; workspace: Workspace };

export type SubagentWorkspace =
  | { pick: "fixed"; source: SubagentWorkspaceSource }
  | {
      pick: "caller";
      sources: readonly [
        SubagentWorkspaceSource,
        ...SubagentWorkspaceSource[],
      ];
      required: boolean;
    };

export type WithoutMeans = {
  tools?: undefined;
  gate?: Gate;
  workspace?: undefined;
};
export type WithMeans = { gate: Gate } & (
  | { tools: readonly Tool[]; workspace?: SubagentWorkspace }
  | { tools?: undefined; workspace: SubagentWorkspace }
);

export type SubagentConfig = SubagentBase & (WithoutMeans | WithMeans);

export const defineSubagent = (
  config: SubagentConfig,
): SubagentConfig => config;
