import type { Provider, Tool } from "@mg/core";
import type { Gate } from "@mg/gate";
import type { HarnessConfig } from "./config.js";

export type SubagentBase = {
  name: string;
  description: string;
  system?: string;
  provider: Provider;
  harness: HarnessConfig;
};

export type WithoutMeans = { tools?: undefined; gate?: Gate };
export type WithMeans = { tools: readonly Tool[]; gate: Gate };

export type SubagentConfig = SubagentBase & (WithoutMeans | WithMeans);

export const defineSubagent = (
  config: SubagentConfig,
): SubagentConfig => config;
