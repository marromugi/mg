import type { TrialEvent } from "../../../../trial/events.js";
import type { ChatItem } from "../transcript.js";

const nextId = (items: readonly ChatItem[]): string =>
  String(items.length);

// The conversation after a message is sent. `restarted` marks that it
// starts over from this message.
export const withSent = (
  items: readonly ChatItem[],
  text: string,
  restarted: boolean,
): ChatItem[] => {
  const marked: ChatItem[] = restarted
    ? [...items, { kind: "restarted", id: nextId(items) }]
    : [...items];
  return [...marked, { kind: "user", id: nextId(marked), text }];
};

export const withStopped = (items: readonly ChatItem[]): ChatItem[] => [
  ...items,
  { kind: "stopped", id: nextId(items) },
];

// The conversation after one event of the answer. Text joins the
// assistant's entry it continues, and a tool's result joins its call.
export const withEvent = (
  items: readonly ChatItem[],
  event: TrialEvent,
): ChatItem[] => {
  switch (event.type) {
    case "text": {
      const last = items.at(-1);
      if (last?.kind === "assistant") {
        return [
          ...items.slice(0, -1),
          { ...last, text: last.text + event.delta },
        ];
      }
      return [
        ...items,
        { kind: "assistant", id: nextId(items), text: event.delta },
      ];
    }
    case "tool-call":
      return [
        ...items,
        {
          kind: "tool",
          id: `${nextId(items)}:${event.id}`,
          name: event.name,
          ...(event.subject === undefined
            ? {}
            : { subject: event.subject }),
          input: event.input,
        },
      ];
    case "tool-result":
      return items.map((item) =>
        item.kind === "tool" &&
        item.result === undefined &&
        item.id.endsWith(`:${event.id}`)
          ? {
              ...item,
              result: { shown: event.result, refused: event.refused },
            }
          : item,
      );
    case "failed":
      return [
        ...items,
        { kind: "failed", id: nextId(items), message: event.message },
      ];
    case "started":
    case "ended":
      return [...items];
  }
};
