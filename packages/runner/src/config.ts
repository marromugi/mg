import type { Provider, Tool } from "@mg/core";
import type { Gate } from "@mg/gate";
import type { TraceSdkOptions } from "@mg/trace/otel";
import type { Workspace } from "@mg/workspace";

export type LoopHarnessConfig = {
  kind: "loop";
  model: string;
  maxTurns: number;
  stream?: boolean;
};
export type HarnessConfig = LoopHarnessConfig;

export type RunConfig = {
  name: string;
  provider: Provider;
  harness: HarnessConfig;
  tools?: readonly Tool[];
  gate?: Gate;
  trace?: Omit<TraceSdkOptions, "sessionId">;
  workspace?: Workspace;
};

export const defineRun = (config: RunConfig): RunConfig => config;
