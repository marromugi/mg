// @ts-expect-error
// oxlint-disable-next-line import/no-duplicates
import { createSubagent } from "./index.js";
import {
  createRunQueue,
  defineSubagent,
  type QueueEnding,
  type SubagentConfig,
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
