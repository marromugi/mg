import type { Provider, Tool } from "@mg/core";
import type { Gate } from "@mg/gate";
import type { Harness } from "@mg/harness";
import { createLoopHarness } from "@mg/harness-loop";
import type { HarnessConfig } from "./config.js";

export const createHarness = (
  harnessConfig: HarnessConfig,
  provider: Provider,
  gate: Gate | undefined,
  tools: readonly Tool[],
): Harness => {
  switch (harnessConfig.kind) {
    case "loop":
      return createLoopHarness({
        provider,
        model: harnessConfig.model,
        tools,
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
