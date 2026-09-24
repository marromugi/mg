import type { Message } from "@mg/core";

const formatMessage = (message: Message): string[] => {
  switch (message.role) {
    case "system":
      return [`[system]\n${message.content}`];
    case "user":
      return [`[user]\n${message.content}`];
    case "tool":
      return [
        `[tool-result ${message.toolCallId}]\n${message.content}`,
      ];
    case "assistant":
      return message.parts.map((part) => {
        switch (part.type) {
          case "text":
            return `[assistant]\n${part.text}`;
          case "reasoning":
            return `[reasoning]\n${part.text}`;
          case "tool-call":
            return `[tool-call ${part.id} ${part.name}]\n${JSON.stringify(
              part.arguments,
            )}`;
        }
      });
  }
};

export const transcribe = (messages: readonly Message[]): string =>
  messages.flatMap(formatMessage).join("\n\n");
