import type { Message } from "@mg/core";
import { deepEqual } from "./deep-equal.js";

export type AddedMessages =
  { kind: "added"; messages: Message[] } | { kind: "diverged" };

export const addedMessages = (
  given: readonly Message[],
  result: readonly Message[],
): AddedMessages => {
  if (result.length < given.length) return { kind: "diverged" };

  for (let index = 0; index < given.length; index++) {
    if (!deepEqual(given[index], result[index])) {
      return { kind: "diverged" };
    }
  }

  return {
    kind: "added",
    messages: result.slice(given.length),
  };
};
