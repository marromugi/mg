import type { Message } from "@mg/core";
import { run } from "@mg/runner";
import config from "./loop-bash.config.ts";

const messages: Message[] = [
  { role: "user", content: process.argv[2] ?? "ls の結果を教えて" },
];

const { sessionId } = await run(config, messages, {
  onEvent: (event) => {
    if (event.type === "text-delta") process.stdout.write(event.delta);
  },
});

console.log(`\nsessionId: ${sessionId}`);
