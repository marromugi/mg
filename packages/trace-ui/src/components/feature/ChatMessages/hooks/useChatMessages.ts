export type ChatToolCall = {
  id?: string;
  name?: string;
  arguments?: unknown;
};

export type ChatMessage = {
  role: string;
  content?: string;
  toolCalls?: ChatToolCall[];
  toolCallId?: string;
  reasoning?: string;
};

export type ChatMessagesResult =
  | { kind: "messages"; messages: ChatMessage[] }
  | { kind: "raw"; raw: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isLegacyMessage = (value: unknown): value is ChatMessage => {
  if (!isRecord(value)) {
    return false;
  }
  const { role, content } = value;
  return (
    typeof role === "string" &&
    (content === undefined || typeof content === "string")
  );
};

const normaliseToolCallPart = (
  part: unknown,
): ChatToolCall | undefined => {
  if (!isRecord(part) || typeof part.name !== "string") {
    return undefined;
  }
  return {
    id: typeof part.id === "string" ? part.id : undefined,
    name: part.name,
    arguments: part.arguments,
  };
};

const normaliseParts = (
  parts: unknown[],
): {
  recognisedCount: number;
  fields: Pick<ChatMessage, "content" | "toolCalls" | "reasoning">;
} => {
  const texts: string[] = [];
  const reasonings: string[] = [];
  const toolCalls: ChatToolCall[] = [];
  let recognisedCount = 0;

  for (const part of parts) {
    if (!isRecord(part)) {
      continue;
    }
    if (part.type === "text" && typeof part.text === "string") {
      texts.push(part.text);
      recognisedCount++;
    } else if (
      part.type === "reasoning" &&
      typeof part.text === "string"
    ) {
      reasonings.push(part.text);
      recognisedCount++;
    } else if (part.type === "tool-call") {
      const toolCall = normaliseToolCallPart(part);
      if (toolCall !== undefined) {
        toolCalls.push(toolCall);
        recognisedCount++;
      }
    }
  }

  return {
    recognisedCount,
    fields: {
      content: texts.join(""),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(reasonings.length > 0
        ? { reasoning: reasonings.join("\n") }
        : {}),
    },
  };
};

export const normaliseChatMessage = (
  value: unknown,
): ChatMessage | undefined => {
  if (!isRecord(value) || typeof value.role !== "string") {
    return undefined;
  }
  if (Array.isArray(value.parts)) {
    const { recognisedCount, fields } = normaliseParts(value.parts);
    if (value.parts.length > 0 && recognisedCount === 0) {
      return undefined;
    }
    return { role: value.role, ...fields };
  }
  return isLegacyMessage(value) ? value : undefined;
};

export const useChatMessages = (raw: string): ChatMessagesResult => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const messages: ChatMessage[] = [];
      for (const entry of parsed) {
        const message = normaliseChatMessage(entry);
        if (message === undefined) {
          return { kind: "raw", raw };
        }
        messages.push(message);
      }
      return { kind: "messages", messages };
    }
  } catch {
    return { kind: "raw", raw };
  }
  return { kind: "raw", raw };
};
