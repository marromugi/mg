import type { Provider, Tool } from "@mg/core";
import type { Gate } from "@mg/gate";
import type { Harness, Subagent } from "@mg/harness";
import { createLoopHarness } from "@mg/loop";
import type { HarnessConfig } from "./config.js";

export type HarnessParts = {
  subagents?: readonly Subagent[];
} & (
  | { gate: Gate; tools?: readonly Tool[] }
  | { gate?: undefined; tools?: undefined }
);

export const createHarness = (
  harnessConfig: HarnessConfig,
  provider: Provider,
  parts: HarnessParts,
): Harness => {
  switch (harnessConfig.kind) {
    case "loop":
      return createLoopHarness({
        provider,
        model: harnessConfig.model,
        maxTurns: harnessConfig.maxTurns,
        stream: harnessConfig.stream,
        ...parts,
      });
    default: {
      const unknown = harnessConfig as { kind: unknown };
      throw new RangeError(
        `unknown harness kind: ${String(unknown.kind)}`,
      );
    }
  }
};
