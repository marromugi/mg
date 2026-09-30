import type { Message } from "@mg/core";
import {
  isString,
  parseArray,
  readMessage,
} from "./recorded-messages.js";
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

const unreadable = (reason: string): SentMessages => ({
  kind: "unreadable",
  reason,
});

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
    const message = readMessage(element);
    if (message === undefined) {
      return unreadable(`input message at ${i} is not a message`);
    }
    input.push(message);
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
