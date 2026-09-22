import { EntryNotJsonError, EntryToolPairingError } from "./errors.js";
import type { ConversationEntry } from "./types.js";

const findNonJsonPath = (
  value: unknown,
  path: string,
): string | undefined => {
  if (value === null) {
    return undefined;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0)
      ? undefined
      : path;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const found = findNonJsonPath(value[index], `${path}[${index}]`);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      for (const key of Object.keys(value)) {
        const found = findNonJsonPath(
          (value as Record<string, unknown>)[key],
          `${path}.${key}`,
        );
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    }
  }

  return path;
};

export const assertJsonEntry = (entry: ConversationEntry): void => {
  const path = findNonJsonPath(entry.messages, "messages");
  if (path !== undefined) {
    throw new EntryNotJsonError("not-json", path);
  }
};

export const assertToolPairing = (entry: ConversationEntry): void => {
  const seen = new Set<string>();
  const pending = new Set<string>();

  for (const message of entry.messages) {
    if (message.role === "assistant") {
      for (const part of message.parts) {
        if (part.type === "tool-call") {
          if (seen.has(part.id)) {
            throw new EntryToolPairingError("duplicate-call", part.id);
          }
          seen.add(part.id);
          pending.add(part.id);
        }
      }
    } else if (message.role === "tool") {
      if (!pending.has(message.toolCallId)) {
        throw new EntryToolPairingError(
          "orphan-result",
          message.toolCallId,
        );
      }
      pending.delete(message.toolCallId);
    }
  }

  const [firstUnanswered] = pending;
  if (firstUnanswered !== undefined) {
    throw new EntryToolPairingError("unanswered-call", firstUnanswered);
  }
};
