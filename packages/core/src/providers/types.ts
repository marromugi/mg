import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import type { ProviderError } from "./errors.js";

export type SystemMessage = { role: "system"; content: string };
export type UserMessage = {
  role: "user";
  content: string;
  // The id of the participant who wrote this message. Absent: unknown.
  author?: string;
};

export type ToolCall = { id: string; name: string; arguments: unknown };

export type ReasoningCarry = { provider: string; data: unknown };
export type TextPart = { type: "text"; text: string };
export type ReasoningPart = {
  type: "reasoning";
  text: string;
  carry?: ReasoningCarry;
};
export type ToolCallCarry = { provider: string; data: unknown };
export type ToolCallPart = { type: "tool-call" } & ToolCall & {
    carry?: ToolCallCarry;
  };
export type AssistantPart = TextPart | ReasoningPart | ToolCallPart;

export type AssistantMessage = {
  role: "assistant";
  parts: AssistantPart[];
};

export type ToolMessage = {
  role: "tool";
  toolCallId: string;
  content: string;
};
export type Message =
  SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export type ToolDefinition<
  TInput extends StandardJSONSchemaV1 = StandardJSONSchemaV1,
> = {
  name: string;
  description?: string;
  input: TInput;
};

export type ToolChoice =
  "auto" | "none" | "required" | { type: "tool"; name: string };

// One failed attempt that will be tried again. `attempt` counts from 1;
// `waitMs` is the wait before the next attempt.
export type ProviderRetry = {
  attempt: number;
  error: ProviderError;
  waitMs: number;
};

export type GenerateRequest = {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  temperature?: number;
  maxTokens?: number;
  halt?: AbortSignal;
  // Called for each failed attempt that will be tried again, after the
  // wait is chosen and before it starts. A listener that throws fails
  // the call with that error.
  onRetry?: (retry: ProviderRetry) => void;
};

export type FinishReason =
  "stop" | "tool_calls" | "length" | "halted" | "other";
export type Usage = { inputTokens: number; outputTokens: number };

// What a provider could not give back faithfully in one request.
export type Omission = {
  kind: "outside-tool-call-id";
  toolCallIds: string[];
};

export type GenerateResponse = {
  parts: AssistantPart[];
  finishReason: FinishReason;
  usage?: Usage;
  omitted?: Omission[];
};

export type StreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "reasoning-delta"; delta: string; carry?: ReasoningCarry }
  | { type: "tool-call"; toolCall: ToolCall; carry?: ToolCallCarry }
  | {
      type: "finish";
      finishReason: FinishReason;
      usage?: Usage;
      omitted?: Omission[];
    };

export interface Provider {
  readonly name?: string;
  /**
   * Whether the provider carries out `toolChoice: "required"` and
   * `toolChoice: { type: "tool", name }`.
   */
  readonly toolForcing: boolean;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  stream(request: GenerateRequest): AsyncIterable<StreamEvent>;
}

export type ToolForcingProvider = Provider & { toolForcing: true };
