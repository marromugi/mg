import type { TestRunEvent } from "../../../../test-run/index.js";

export type RunEventView =
  | { kind: "none" }
  | { kind: "text"; text: string }
  | { kind: "tool-call"; name: string; input: string }
  | { kind: "tool-result"; content: string }
  | {
      kind: "ended";
      reason: string;
      inputTokens: string;
      outputTokens: string;
      tracePath: string;
    }
  | { kind: "stopped"; tracePath: string }
  | { kind: "failed"; message: string; tracePath: string };

export const useRunEvent = (event: TestRunEvent): RunEventView => {
  switch (event.type) {
    case "harness": {
      const inner = event.event;
      switch (inner.type) {
        case "text-delta":
          return { kind: "text", text: inner.delta };
        case "tool-call":
          return {
            kind: "tool-call",
            name: inner.toolCall.name,
            input:
              JSON.stringify(inner.toolCall.arguments, null, 2) ?? "",
          };
        case "tool-result":
          return {
            kind: "tool-result",
            content: inner.message.content,
          };
        default:
          return { kind: "none" };
      }
    }
    case "ended":
      return {
        kind: "ended",
        reason: event.reason,
        inputTokens: String(event.usage.inputTokens),
        outputTokens: String(event.usage.outputTokens),
        tracePath: event.tracePath,
      };
    case "stopped":
      return { kind: "stopped", tracePath: event.tracePath };
    case "failed":
      return {
        kind: "failed",
        message: event.message,
        tracePath: event.tracePath,
      };
  }
};
