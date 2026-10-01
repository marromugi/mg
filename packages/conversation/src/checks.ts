import { findToolPairingProblem } from "@mg/core";
import {
  ConversationToolCallIdError,
  EntryNotJsonError,
  EntryToolPairingError,
} from "./errors.js";
import { MAX_JSON_DEPTH } from "./limits.js";
import type { ConversationEntry, StoredToolCall } from "./types.js";

type NonJsonFound = {
  kind: "not-json" | "cycle" | "too-deep";
  path: string;
};

const findNonJsonPath = (
  value: unknown,
  path: string,
  onPath: Set<object>,
  depth: number,
): NonJsonFound | undefined => {
  if (value === null) {
    return undefined;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0)
      ? undefined
      : { kind: "not-json", path };
  }

  if (Array.isArray(value)) {
    if (depth > MAX_JSON_DEPTH) {
      return { kind: "too-deep", path };
    }
    if (onPath.has(value)) {
      return { kind: "cycle", path };
    }
    onPath.add(value);
    for (let index = 0; index < value.length; index++) {
      const found = findNonJsonPath(
        value[index],
        `${path}[${index}]`,
        onPath,
        depth + 1,
      );
      if (found !== undefined) {
        onPath.delete(value);
        return found;
      }
    }
    onPath.delete(value);
    return undefined;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      if (depth > MAX_JSON_DEPTH) {
        return { kind: "too-deep", path };
      }
      if (onPath.has(value)) {
        return { kind: "cycle", path };
      }
      onPath.add(value);
      for (const key of Object.keys(value)) {
        const found = findNonJsonPath(
          (value as Record<string, unknown>)[key],
          `${path}.${key}`,
          onPath,
          depth + 1,
        );
        if (found !== undefined) {
          onPath.delete(value);
          return found;
        }
      }
      onPath.delete(value);
      return undefined;
    }
  }

  return { kind: "not-json", path };
};

export const assertJsonEntry = (entry: ConversationEntry): void => {
  const found = findNonJsonPath(
    entry.messages,
    "messages",
    new Set(),
    1,
  );
  if (found !== undefined) {
    throw new EntryNotJsonError(found.kind, found.path);
  }
};

export const assertToolPairing = (entry: ConversationEntry): void => {
  const problem = findToolPairingProblem(entry.messages);
  if (problem !== undefined) {
    throw new EntryToolPairingError(problem.kind, problem.toolCallId);
  }
};

export const assertNewToolCallIds = (
  stored: readonly StoredToolCall[],
  entry: ConversationEntry,
): void => {
  const lowest = new Map<string, number>();
  for (const { id, position } of stored) {
    const known = lowest.get(id);
    if (known === undefined || position < known) {
      lowest.set(id, position);
    }
  }

  for (const message of entry.messages) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const part of message.parts) {
      if (part.type !== "tool-call") {
        continue;
      }
      const position = lowest.get(part.id);
      if (position !== undefined) {
        throw new ConversationToolCallIdError(part.id, position);
      }
    }
  }
};
