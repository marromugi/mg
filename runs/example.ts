import type { Message } from "@mg/core";
import { run } from "@mg/runner";
import config from "./loop-bash-gate.config.ts";
import { showRun } from "./show-run.ts";

const input = process.argv[2] ?? "ls の結果を教えて";
const messages: Message[] = [{ role: "user", content: input }];

process.exitCode = await showRun((onEvent) =>
  run(config, messages, { onEvent }),
);
