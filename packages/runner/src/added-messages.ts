import type { Message } from "@mg/core";
import type { ConversationMessage } from "@mg/conversation";

export type AddedMessages =
  | { kind: "added"; messages: ConversationMessage[] }
  | { kind: "diverged" };

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;

  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.hasOwn(bRecord, key) &&
      deepEqual(aRecord[key], bRecord[key]),
  );
};

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
    messages: result.slice(given.length) as ConversationMessage[],
  };
};
