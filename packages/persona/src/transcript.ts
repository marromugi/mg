import type { Message, UserMessage } from "@mg/core";

const userTag = (message: UserMessage): string => {
  const { author } = message;
  if (author === undefined) return "[user]";
  if (author.trim() === "") {
    throw new RangeError("user message author must not be blank");
  }
  return `[user ${JSON.stringify(author)}]`;
};

const formatMessage = (message: Message): string[] => {
  switch (message.role) {
    case "system":
      return [`[system]\n${message.content}`];
    case "user":
      return [`${userTag(message)}\n${message.content}`];
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
