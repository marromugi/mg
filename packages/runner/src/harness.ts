import type { Tool } from "@mg/core";
import type { Harness } from "@mg/harness";
import { createLoopHarness } from "@mg/harness-loop";
import type { RunConfig } from "./config.js";

export const createHarness = (
  config: RunConfig,
  tools: readonly Tool[],
): Harness => {
  switch (config.harness.kind) {
    case "loop":
      return createLoopHarness({
        provider: config.provider,
        model: config.harness.model,
        tools,
        maxTurns: config.harness.maxTurns,
        stream: config.harness.stream,
        gate: config.gate,
      });
    default: {
      const unknown = config.harness as { kind: unknown };
      throw new RangeError(
        `unknown harness kind: ${String(unknown.kind)}`,
      );
    }
  }
};
