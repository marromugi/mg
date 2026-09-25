import type { Message } from "@mg/core";
import { deepEqual } from "./deep-equal.js";
import type { DeliveredPosition } from "./keep-delivered.js";
import { keepDelivered } from "./keep-delivered.js";

/**
 * Whether `answer` is one of the acceptable ways to keep `added`: `added`
 * itself, or `added` cut at some delivered position (see `keepDelivered`).
 */
export const keptMessages = (
  added: readonly Message[],
  answer: readonly Message[],
): boolean => {
  const positions: DeliveredPosition[] = [{ kind: "all" }];

  let turn = 0;
  for (const message of added) {
    if (message.role !== "assistant") continue;
    const totalLength = message.parts
      .filter((part) => part.type === "text")
      .reduce((sum, part) => sum + part.text.length, 0);
    for (let end = 0; end <= totalLength; end++) {
      positions.push({ kind: "until", turn, end });
    }
    turn++;
  }

  return positions.some((position) =>
    deepEqual(keepDelivered(added, position), answer),
  );
};
