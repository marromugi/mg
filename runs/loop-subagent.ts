import { run } from "@mg/runner";
import { readOneInput } from "./one-input.ts";
import { showRun } from "./show-run.ts";

const read = readOneInput(
  process.argv.slice(2),
  "runs/loop-subagent.ts",
);
if (!read.ok) {
  console.error(read.usage);
  process.exit(2);
}
const { default: config } = await import("./loop-subagent.config.ts");
process.exitCode = await showRun((onEvent) =>
  run(config, [{ role: "user", content: read.input }], { onEvent }),
);
