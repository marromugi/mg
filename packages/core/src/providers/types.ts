import type { StandardJSONSchemaV1 } from "@standard-schema/spec";

export type SystemMessage = { role: "system"; content: string };
export type UserMessage = { role: "user"; content: string };
export type AssistantMessage = {
  role: "assistant";
  content: string;
  toolCalls?: ToolCall[];
};
export type ToolMessage = {
  role: "tool";
  toolCallId: string;
  content: string;
};
export type Message =
  SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export type ToolCall = { id: string; name: string; arguments: unknown };

export type ToolDefinition<
  TInput extends StandardJSONSchemaV1 = StandardJSONSchemaV1,
> = {
  name: string;
  description?: string;
  input: TInput;
};

export type ToolChoice =
  "auto" | "none" | "required" | { type: "tool"; name: string };

export type GenerateRequest = {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  temperature?: number;
  maxTokens?: number;
};

export type FinishReason = "stop" | "tool_calls" | "length" | "other";
export type Usage = { inputTokens: number; outputTokens: number };

export type GenerateResponse = {
  content: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage?: Usage;
};

export type StreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; toolCall: ToolCall }
  | { type: "finish"; finishReason: FinishReason; usage?: Usage };

export interface Provider {
  readonly name?: string;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  stream(request: GenerateRequest): AsyncIterable<StreamEvent>;
}
