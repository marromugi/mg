// Attribute names checked against open-telemetry/semantic-conventions-genai
// @ 0c87594975195608dc91b3f702e250a7b240c151, docs/gen-ai/gen-ai-spans.md and
// docs/gen-ai/gen-ai-agent-spans.md.
import type { Attributes } from "@opentelemetry/api";
import type { ToolCall } from "@mg/core";
import { jsonAttribute } from "../json.js";
import { ATTR } from "../vocabulary.js";

const GEN_AI_PROVIDER_NAME = "gen_ai.provider.name";
const GEN_AI_OPERATION_NAME = "gen_ai.operation.name";
const GEN_AI_REQUEST_MODEL = "gen_ai.request.model";
const GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens";
const GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens";
const GEN_AI_TOOL_NAME = "gen_ai.tool.name";
const GEN_AI_INPUT_MESSAGES = "gen_ai.input.messages";
const GEN_AI_OUTPUT_MESSAGES = "gen_ai.output.messages";
const GEN_AI_RESPONSE_FINISH_REASONS = "gen_ai.response.finish_reasons";

const OPERATION_NAMES: Record<string, string> = {
  harness: "invoke_agent",
  llm: "chat",
  tool: "execute_tool",
};

type GenAiPart =
  | { type: "text"; content: string }
  | { type: "reasoning"; content: string }
  | {
      type: "tool_call";
      id?: string;
      name: string;
      arguments?: unknown;
    }
  | { type: "tool_call_response"; id?: string; response: unknown };

type GenAiMessage = {
  role: string;
  parts: GenAiPart[];
};

type MessageLike = { role: string } & Record<string, unknown>;

const isMessageLike = (value: unknown): value is MessageLike =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { role?: unknown }).role === "string";

const toStoredAssistantPart = (
  value: unknown,
): GenAiPart | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const part = value as Record<string, unknown>;
  switch (part.type) {
    case "text":
      return typeof part.text === "string"
        ? { type: "text", content: part.text }
        : undefined;
    case "reasoning":
      return typeof part.text === "string"
        ? { type: "reasoning", content: part.text }
        : undefined;
    case "tool-call":
      return typeof part.name === "string"
        ? {
            type: "tool_call",
            id: typeof part.id === "string" ? part.id : undefined,
            name: part.name,
            arguments: part.arguments,
          }
        : undefined;
    default:
      return undefined;
  }
};

const toParts = (message: MessageLike): GenAiPart[] => {
  switch (message.role) {
    case "system":
    case "user":
      return [{ type: "text", content: message.content as string }];
    case "assistant": {
      if (Array.isArray(message.parts)) {
        return message.parts
          .map(toStoredAssistantPart)
          .filter((part): part is GenAiPart => part !== undefined);
      }
      const parts: GenAiPart[] = [];
      const content = message.content as string;
      if (content !== "") {
        parts.push({ type: "text", content });
      }
      const toolCalls = Array.isArray(message.toolCalls)
        ? (message.toolCalls as ToolCall[])
        : [];
      for (const toolCall of toolCalls) {
        parts.push({
          type: "tool_call",
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        });
      }
      return parts;
    }
    case "tool":
      return [
        {
          type: "tool_call_response",
          id: message.toolCallId as string | undefined,
          response: message.content,
        },
      ];
    default:
      return typeof message.content === "string"
        ? [{ type: "text", content: message.content }]
        : [];
  }
};

const toGenAiMessage = (message: MessageLike): GenAiMessage => ({
  role: message.role,
  parts: toParts(message),
});

const parseMessages = (json: unknown): MessageLike[] | undefined => {
  if (typeof json !== "string") return undefined;
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isMessageLike)
      : undefined;
  } catch {
    return undefined;
  }
};

const mapInputMessages = (
  attributes: Attributes,
): string | undefined => {
  const messages = parseMessages(attributes[ATTR.llmInputMessages]);
  if (messages === undefined) return undefined;
  return jsonAttribute(messages.map(toGenAiMessage));
};

const mapOutputMessages = (
  attributes: Attributes,
): string | undefined => {
  const messages = parseMessages(attributes[ATTR.llmOutputMessages]);
  if (messages === undefined) return undefined;
  return jsonAttribute(messages.map(toGenAiMessage));
};

const mapLlmAttributes = (attributes: Attributes): Attributes => {
  const mapped: Attributes = {};

  const providerName = attributes[ATTR.llmProvider];
  if (typeof providerName === "string") {
    mapped[GEN_AI_PROVIDER_NAME] = providerName; // gen_ai.provider.name
  }

  const model = attributes[ATTR.llmModel];
  if (typeof model === "string") {
    mapped[GEN_AI_REQUEST_MODEL] = model; // gen_ai.request.model
  }

  const inputTokens = attributes[ATTR.llmInputTokens];
  if (typeof inputTokens === "number") {
    mapped[GEN_AI_USAGE_INPUT_TOKENS] = inputTokens; // gen_ai.usage.input_tokens
  }

  const outputTokens = attributes[ATTR.llmOutputTokens];
  if (typeof outputTokens === "number") {
    mapped[GEN_AI_USAGE_OUTPUT_TOKENS] = outputTokens; // gen_ai.usage.output_tokens
  }

  const finishReason = attributes[ATTR.llmFinishReason];
  if (typeof finishReason === "string") {
    mapped[GEN_AI_RESPONSE_FINISH_REASONS] = [finishReason]; // gen_ai.response.finish_reasons
  }

  const inputMessages = mapInputMessages(attributes);
  if (inputMessages !== undefined) {
    mapped[GEN_AI_INPUT_MESSAGES] = inputMessages; // gen_ai.input.messages
  }

  const outputMessages = mapOutputMessages(attributes);
  if (outputMessages !== undefined) {
    mapped[GEN_AI_OUTPUT_MESSAGES] = outputMessages; // gen_ai.output.messages
  }

  return mapped;
};

export const mapGenAiAttributes = (
  attributes: Attributes,
): Attributes => {
  const op = attributes[ATTR.op];
  if (typeof op !== "string") return {};

  const operationName = OPERATION_NAMES[op];
  if (operationName === undefined) return {};

  const mapped: Attributes = {
    [GEN_AI_OPERATION_NAME]: operationName, // gen_ai.operation.name
  };

  if (op === "llm") {
    Object.assign(mapped, mapLlmAttributes(attributes));
  } else if (op === "tool") {
    const toolName = attributes[ATTR.toolName];
    if (typeof toolName === "string") {
      mapped[GEN_AI_TOOL_NAME] = toolName; // gen_ai.tool.name
    }
  }

  return mapped;
};
