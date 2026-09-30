import type { AssistantMessage } from "@mg/core";
import { parseArray, readMessage } from "./recorded-messages.js";
import type { RecordedSpan } from "./sent-messages.js";
import { ATTR } from "./vocabulary.js";

export type ReceivedMessages =
  | { kind: "messages"; messages: AssistantMessage[] }
  | { kind: "unreadable"; reason: string };

const unreadable = (reason: string): ReceivedMessages => ({
  kind: "unreadable",
  reason,
});

export const receivedMessagesOf = (
  span: RecordedSpan,
): ReceivedMessages => {
  const raw = span.attributes[ATTR.llmOutputMessages];
  if (typeof raw !== "string") {
    return unreadable("output messages are missing");
  }
  const elements = parseArray(raw);
  if (elements === undefined) {
    return unreadable("output messages are not a JSON array");
  }

  const messages: AssistantMessage[] = [];
  for (const [i, element] of elements.entries()) {
    const message = readMessage(element);
    if (message === undefined || message.role !== "assistant") {
      return unreadable(
        `output message at ${i} is not an assistant message`,
      );
    }
    messages.push(message);
  }
  return { kind: "messages", messages };
};
