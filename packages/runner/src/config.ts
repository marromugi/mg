import type { Provider, Tool } from "@mg/core";
import type { Gate } from "@mg/gate";
import type { TraceSdkOptions } from "@mg/trace/otel";
import type { Workspace } from "@mg/workspace";
import type { SubagentConfig } from "./subagent-config.js";

export type LoopHarnessConfig = {
  kind: "loop";
  model: string;
  maxTurns: number;
  stream?: boolean;
};
export type HarnessConfig = LoopHarnessConfig;

type RunBase = {
  name: string;
  provider: Provider;
  harness: HarnessConfig;
  trace?: Omit<TraceSdkOptions, "sessionId">;
  subagents?: readonly SubagentConfig[];
};

export type GatedRunConfig = RunBase & {
  gate: Gate;
  tools?: readonly Tool[];
  workspace?: Workspace;
};

export type UngatedRunConfig = RunBase & {
  gate?: undefined;
  tools?: undefined;
  workspace?: undefined;
};

export type RunConfig = GatedRunConfig | UngatedRunConfig;

export function defineRun(config: GatedRunConfig): GatedRunConfig;
export function defineRun(config: UngatedRunConfig): UngatedRunConfig;
export function defineRun(config: RunConfig): RunConfig {
  return config;
}
