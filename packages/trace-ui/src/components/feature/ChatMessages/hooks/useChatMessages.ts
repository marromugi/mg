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
};

export type ChatMessagesResult =
  | { kind: "messages"; messages: ChatMessage[] }
  | { kind: "raw"; raw: string };

const isChatMessage = (value: unknown): value is ChatMessage => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { role, content } = value as {
    role?: unknown;
    content?: unknown;
  };
  return (
    typeof role === "string" &&
    (content === undefined || typeof content === "string")
  );
};

export const useChatMessages = (raw: string): ChatMessagesResult => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(isChatMessage)) {
      return { kind: "messages", messages: parsed };
    }
  } catch {
    return { kind: "raw", raw };
  }
  return { kind: "raw", raw };
};
