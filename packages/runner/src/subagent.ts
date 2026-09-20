import type { Message } from "@mg/core";
import { textOf } from "@mg/core";
import { collect } from "@mg/harness";
import type { Subagent } from "@mg/harness";
import { z } from "zod";
import { createHarness } from "./harness.js";
import type { SubagentConfig } from "./subagent-config.js";

const inputSchema = z.object({
  prompt: z
    .string()
    .describe(
      "The task for the subagent. It starts with no memory of this conversation, so include everything it needs.",
    ),
});

const lastAssistantText = (messages: readonly Message[]): string => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "assistant") return textOf(message);
  }
  return "";
};

const finishedText = (text: string): string =>
  text === ""
    ? "[empty] The subagent finished without a final message."
    : text;

const maxTurnsText = (maxTurns: number, text: string): string => {
  const prefix = `[incomplete] The subagent reached its turn limit of ${maxTurns} before finishing. No final answer was produced. Its last message before the limit`;
  return text === ""
    ? `${prefix} was empty.`
    : `${prefix} follows:\n${text}`;
};

const lengthText = (text: string): string => {
  const prefix =
    "[incomplete] The subagent's output was cut off at the model's length limit. The cut-off text";
  return text === ""
    ? `${prefix} was empty.`
    : `${prefix} follows:\n${text}`;
};

export const createSubagent = (config: SubagentConfig): Subagent => {
  const tools = config.tools ?? [];
  createHarness(config.harness, config.provider, config.gate, tools);

  const subagent: Subagent<typeof inputSchema> = {
    name: config.name,
    description: config.description,
    input: inputSchema,
    async start(input, context) {
      const harness = createHarness(
        config.harness,
        config.provider,
        config.gate,
        tools,
      );
      const messages: Message[] = config.system
        ? [
            { role: "system", content: config.system },
            { role: "user", content: input.prompt },
          ]
        : [{ role: "user", content: input.prompt }];

      const result = await collect(
        harness({
          messages,
          signal: context.signal,
          trace: context.trace,
        }),
      );

      const text = lastAssistantText(result.messages);
      switch (result.reason) {
        case "stop":
          return finishedText(text);
        case "max-turns":
          return maxTurnsText(config.harness.maxTurns, text);
        case "length":
          return lengthText(text);
      }
    },
  };
  return subagent;
};
