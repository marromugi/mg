import type { Provider, Tool } from "@mg/core";
import type { Gate } from "@mg/gate";
import type { Harness, Subagent } from "@mg/harness";
import { createLoopHarness } from "@mg/loop";
import type { HarnessConfig } from "./config.js";

export const createHarness = (
  harnessConfig: HarnessConfig,
  provider: Provider,
  gate: Gate | undefined,
  tools: readonly Tool[],
  subagents?: readonly Subagent[],
): Harness => {
  switch (harnessConfig.kind) {
    case "loop":
      return createLoopHarness({
        provider,
        model: harnessConfig.model,
        tools,
        subagents,
        maxTurns: harnessConfig.maxTurns,
        stream: harnessConfig.stream,
        gate,
      });
    default: {
      const unknown = harnessConfig as { kind: unknown };
      throw new RangeError(
        `unknown harness kind: ${String(unknown.kind)}`,
      );
    }
  }
};
