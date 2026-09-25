import type { AssistantPart, Message } from "@mg/core";

export type DeliveredPosition =
  { kind: "all" } | { kind: "until"; turn: number; end: number };

export const keepDelivered = (
  added: readonly Message[],
  position: DeliveredPosition,
): Message[] => {
  if (position.kind === "all") return [...added];

  const { turn, end } = position;

  const assistantIndexes: number[] = [];
  added.forEach((message, index) => {
    if (message.role === "assistant") assistantIndexes.push(index);
  });

  if (turn < 0 || turn >= assistantIndexes.length) {
    throw new RangeError(
      `keepDelivered: turn ${turn} is out of range; ` +
        `added has ${assistantIndexes.length} assistant message(s)`,
    );
  }

  const targetIndex = assistantIndexes[turn];
  const target = added[targetIndex];
  if (target?.role !== "assistant") {
    throw new RangeError(`keepDelivered: turn ${turn} is out of range`);
  }

  const totalLength = target.parts
    .filter((part) => part.type === "text")
    .reduce((sum, part) => sum + part.text.length, 0);

  if (end < 0 || end > totalLength) {
    throw new RangeError(
      `keepDelivered: end ${end} is out of range; ` +
        `turn ${turn} has ${totalLength} character(s) of text`,
    );
  }

  let remaining = end;
  const result: Message[] = [];

  for (let index = 0; index < added.length; index++) {
    const message = added[index];

    if (message.role !== "assistant") {
      result.push(message);
      continue;
    }

    if (index < targetIndex) {
      result.push(message);
      continue;
    }

    if (index > targetIndex) {
      const parts = message.parts.filter(
        (part) => part.type !== "text",
      );
      if (parts.length > 0) result.push({ ...message, parts });
      continue;
    }

    const parts = message.parts.flatMap((part): AssistantPart[] => {
      if (part.type !== "text") return [part];
      if (remaining >= part.text.length) {
        remaining -= part.text.length;
        return [part];
      }
      if (remaining > 0) {
        const sliced = { ...part, text: part.text.slice(0, remaining) };
        remaining = 0;
        return [sliced];
      }
      return [];
    });
    if (parts.length > 0) result.push({ ...message, parts });
  }

  return result;
};
