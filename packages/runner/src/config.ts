import type { Provider, Tool } from "@mg/core";
import type { TraceSdkOptions } from "@mg/trace/otel";

export type LoopHarnessConfig = { kind: "loop"; model: string; maxTurns: number; stream?: boolean };
export type HarnessConfig = LoopHarnessConfig;

export type RunConfig = {
  name: string;
  provider: Provider;
  harness: HarnessConfig;
  tools?: readonly Tool[];
  trace?: Omit<TraceSdkOptions, "sessionId">;
};

export const defineRun = (config: RunConfig): RunConfig => config;
