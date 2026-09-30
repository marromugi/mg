import type { AssistantPart, Message } from "@mg/core";

export const isRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isString = (value: unknown): value is string =>
  typeof value === "string";

const isPart = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (value.type === "text" || value.type === "reasoning") {
    return isString(value.text);
  }
  if (value.type === "tool-call") {
    return isString(value.id) && isString(value.name);
  }
  return false;
};

const isCoreMessage = (value: Record<string, unknown>): boolean => {
  switch (value.role) {
    case "system":
      return isString(value.content);
    case "user":
      return (
        isString(value.content) &&
        (value.author === undefined || isString(value.author))
      );
    case "tool":
      return isString(value.toolCallId) && isString(value.content);
    case "assistant":
      return Array.isArray(value.parts) && value.parts.every(isPart);
    default:
      return false;
  }
};

type OlderToolCall = { id: string; name: string; arguments?: unknown };

const isOlderToolCall = (value: unknown): value is OlderToolCall =>
  isRecord(value) && isString(value.id) && isString(value.name);

const isOlderAssistant = (value: Record<string, unknown>): boolean =>
  value.role === "assistant" &&
  value.parts === undefined &&
  isString(value.content) &&
  (value.toolCalls === undefined ||
    (Array.isArray(value.toolCalls) &&
      value.toolCalls.every(isOlderToolCall)));

const fromOlderAssistant = (
  value: Record<string, unknown>,
): Message => {
  const parts: AssistantPart[] = [];
  if (value.content !== "") {
    parts.push({ type: "text", text: value.content as string });
  }
  for (const call of (value.toolCalls ?? []) as OlderToolCall[]) {
    parts.push({
      type: "tool-call",
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    });
  }
  return { role: "assistant", parts };
};

export const readMessage = (value: unknown): Message | undefined => {
  if (!isRecord(value)) return undefined;
  if (isCoreMessage(value)) return value as Message;
  if (isOlderAssistant(value)) return fromOlderAssistant(value);
  return undefined;
};

export const parseArray = (raw: string): unknown[] | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};
