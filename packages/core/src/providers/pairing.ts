import type { Message } from "./types.js";

export type ToolPairingProblem = {
  kind: "duplicate-call" | "orphan-result" | "unanswered-call";
  toolCallId: string;
};

/**
 * Finds the first place where tool calls and tool results do not pair up:
 * a call id used twice, a result with no call before it, or a call with
 * no result after it.
 */
export const findToolPairingProblem = (
  messages: readonly Message[],
): ToolPairingProblem | undefined => {
  const seen = new Set<string>();
  const pending = new Set<string>();

  for (const message of messages) {
    if (message.role === "assistant") {
      for (const part of message.parts) {
        if (part.type === "tool-call") {
          if (seen.has(part.id)) {
            return { kind: "duplicate-call", toolCallId: part.id };
          }
          seen.add(part.id);
          pending.add(part.id);
        }
      }
    } else if (message.role === "tool") {
      if (!pending.has(message.toolCallId)) {
        return {
          kind: "orphan-result",
          toolCallId: message.toolCallId,
        };
      }
      pending.delete(message.toolCallId);
    }
  }

  const [firstUnanswered] = pending;
  if (firstUnanswered !== undefined) {
    return { kind: "unanswered-call", toolCallId: firstUnanswered };
  }
  return undefined;
};
