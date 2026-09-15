import type { Harness } from "@mg/harness";
import { createLoopHarness } from "@mg/harness-loop";
import type { RunConfig } from "./config.js";

export const createHarness = (config: RunConfig): Harness => {
  switch (config.harness.kind) {
    case "loop":
      return createLoopHarness({
        provider: config.provider,
        model: config.harness.model,
        tools: config.tools,
        maxTurns: config.harness.maxTurns,
        stream: config.harness.stream,
      });
    default: {
      const unknown = config.harness as { kind: unknown };
      throw new RangeError(
        `unknown harness kind: ${String(unknown.kind)}`,
      );
    }
  }
};
