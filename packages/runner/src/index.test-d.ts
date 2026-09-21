// @ts-expect-error
// oxlint-disable-next-line import/no-duplicates
import { createSubagent } from "./index.js";
import { defineSubagent, type SubagentConfig } from "./index.js";

export const indexExportsCreateSubagent = createSubagent;
export const indexExportsDefineSubagent = defineSubagent;
export type IndexExportsSubagentConfig = SubagentConfig;
