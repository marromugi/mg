import { fileURLToPath } from "node:url";
import type { RunConfig } from "@mg/runner";
import { JsonlTraceReader } from "@mg/trace/store";

// <repo root>/.mg/<file>, resolved from this module's own location so the
// result does not depend on the process's current working directory.
export function outputPath(file: string): string {
  return fileURLToPath(new URL(`../.mg/${file}`, import.meta.url));
}

export function traceReaderFor(config: RunConfig): JsonlTraceReader {
  const jsonlPath = config.trace?.jsonlPath;
  if (jsonlPath === undefined) {
    throw new Error(`${config.name}: trace.jsonlPath is not set`);
  }
  return new JsonlTraceReader(jsonlPath);
}
