import type { Message, Tool } from "@mg/core";
// @ts-expect-error
// oxlint-disable-next-line import/no-duplicates
import { createSubagent } from "./index.js";
import {
  createRunQueue,
  defineSubagent,
  run,
  type GatedRunConfig,
  type QueueEnding,
  type RunConfig,
  type SubagentConfig,
  type UngatedRunConfig,
} from "./index.js";

export const indexExportsCreateSubagent = createSubagent;
export const indexExportsDefineSubagent = defineSubagent;
export type IndexExportsSubagentConfig = SubagentConfig;

export const indexExportsCreateRunQueue = createRunQueue;

declare const ending: QueueEnding<string>;

if (ending.kind === "finished") {
  const outcome: string = ending.outcome;
  void outcome;
  // @ts-expect-error `error` only exists on the "failed" ending
  void ending.error;
} else if (ending.kind === "failed") {
  const error: unknown = ending.error;
  void error;
  // @ts-expect-error `outcome` only exists on the "finished" ending
  void ending.outcome;
} else {
  const reason: "closed" = ending.reason;
  void reason;
  // @ts-expect-error `outcome` only exists on the "finished" ending
  void ending.outcome;
}

declare const gated: GatedRunConfig;
declare const plain: UngatedRunConfig;
declare const either: RunConfig;
declare const messages: Message[];
declare const tool: Tool;
declare const signal: AbortSignal;

export const runOnGatedWithTools = run(gated, messages, {
  tools: [tool],
});

export const runOnPlainWithTools = run(plain, messages, {
  // @ts-expect-error an ungated config cannot receive tools for the call
  tools: [tool],
});

export const runOnPlainWithSignal = run(plain, messages, { signal });

export const runOnEither = run(either, messages);

export const runOnEitherWithSignal = run(either, messages, { signal });

export const runOnEitherWithTools = run(either, messages, {
  // @ts-expect-error a run config that might be ungated cannot receive tools for the call
  tools: [tool],
});
