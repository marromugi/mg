import type { AssistantPart, Message } from "@mg/core";
import { ATTR, EVENT } from "./vocabulary.js";

export type RecordedSpan = {
  attributes: Readonly<Record<string, unknown>>;
  events: readonly {
    name: string;
    attributes?: Readonly<Record<string, unknown>>;
  }[];
};

export type SentMessages =
  | { kind: "messages"; messages: Message[] }
  | { kind: "unreadable"; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string =>
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

const unreadable = (reason: string): SentMessages => ({
  kind: "unreadable",
  reason,
});

const parseArray = (raw: string): unknown[] | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const sentMessagesOf = (span: RecordedSpan): SentMessages => {
  const raw = span.attributes[ATTR.llmInputMessages];
  if (typeof raw !== "string") {
    return unreadable("input messages are missing");
  }
  const elements = parseArray(raw);
  if (elements === undefined) {
    return unreadable("input messages are not a JSON array");
  }

  const input: Message[] = [];
  for (const [i, element] of elements.entries()) {
    if (isRecord(element) && isCoreMessage(element)) {
      input.push(element as Message);
    } else if (isRecord(element) && isOlderAssistant(element)) {
      input.push(fromOlderAssistant(element));
    } else {
      return unreadable(`input message at ${i} is not a message`);
    }
  }

  const count = span.attributes[ATTR.llmSystemCount];
  const events = span.events.filter((e) => e.name === EVENT.llmSystem);

  if (count === undefined) {
    if (events.length > 0) {
      return unreadable(
        "system events are recorded but the system count is missing",
      );
    }
    return { kind: "messages", messages: input };
  }

  const at = input.findIndex((m) => m.role === "system");
  if (at !== -1) {
    return unreadable(
      `input message at ${at} is a system message, but the span records system messages as events`,
    );
  }

  const length = input.length + events.length;
  const placed = new Map<number, Message>();
  for (const [k, event] of events.entries()) {
    const content = event.attributes?.[ATTR.llmSystemContent];
    const index = event.attributes?.[ATTR.llmSystemIndex];
    if (!isString(content)) {
      return unreadable(`system event ${k} has no text content`);
    }
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0
    ) {
      return unreadable(`system event ${k} has no valid index`);
    }
    if (placed.has(index)) {
      return unreadable(`two system events have index ${index}`);
    }
    if (index >= length) {
      return unreadable(
        `system event index ${index} is outside the ${length} sent messages`,
      );
    }
    placed.set(index, { role: "system", content });
  }
  if (count !== events.length) {
    return unreadable(
      `expected ${String(count)} system events, found ${events.length}`,
    );
  }

  const rest = input[Symbol.iterator]();
  const messages: Message[] = [];
  for (let i = 0; i < length; i++) {
    messages.push(placed.get(i) ?? (rest.next().value as Message));
  }
  return { kind: "messages", messages };
};
