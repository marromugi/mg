import type { Message } from "@mg/core";
import type { TextTriggerInput } from "@mg/trigger";

export const toMessages = (input: TextTriggerInput): Message[] => [
  {
    role: "user",
    author: "user",
    content: `The user just muttered to themselves: "${input.text}"`,
  },
];
