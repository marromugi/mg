import type { Message } from "@mg/core";
import { run } from "@mg/runner";
import { term } from "@mg/term";
import config from "./loop-bash.config.ts";

const messages: Message[] = [
  { role: "user", content: process.argv[2] ?? "ls の結果を教えて" },
];

let atLineStart = true;

try {
  const { sessionId } = await run(config, messages, {
    onEvent: (event) => {
      if (event.type === "text-delta") {
        process.stdout.write(event.delta);
        if (event.delta !== "")
          atLineStart = event.delta.endsWith("\n");
      } else if (event.type === "tool-call") {
        if (!atLineStart) process.stdout.write("\n");
        const { name, arguments: args } = event.toolCall;
        const line = `${term.mark.muted} ${name} ${JSON.stringify(args)}`;
        console.log(term.paint("muted", line));
        atLineStart = true;
      }
    },
  });

  if (!atLineStart) process.stdout.write("\n");
  const line = `${term.mark.success} sessionId: ${sessionId}`;
  console.log(term.paint("success", line));
} catch (error) {
  const message =
    error instanceof Error ? error.message : String(error);
  console.error(term.paint("error", `${term.mark.error} ${message}`));
  process.exitCode = 1;
}
