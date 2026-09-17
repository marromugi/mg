import type {
  FinishReason,
  Message,
  ToolCall,
  ToolMessage,
  Usage,
} from "@mg/core";
import type { TraceSpan } from "./trace.js";

export type HarnessInput = {
  messages: Message[];
  signal?: AbortSignal;
  trace?: TraceSpan;
};

export type HarnessStopReason = "stop" | "max-turns" | "length";

export type HarnessResult = {
  reason: HarnessStopReason;
  messages: Message[];
  usage: Usage;
};

export type HarnessEvent =
  | { type: "text-delta"; delta: string }
  | { type: "reasoning-delta"; delta: string }
  | { type: "tool-call"; toolCall: ToolCall }
  | { type: "tool-result"; message: ToolMessage }
  | { type: "turn"; finishReason: FinishReason; usage?: Usage }
  | { type: "done"; result: HarnessResult };

export type Harness = (
  input: HarnessInput,
) => AsyncIterable<HarnessEvent>;
