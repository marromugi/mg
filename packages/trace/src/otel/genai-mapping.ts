// Attribute names checked against open-telemetry/semantic-conventions-genai
// @ 0c87594975195608dc91b3f702e250a7b240c151, docs/gen-ai/gen-ai-spans.md and
// docs/gen-ai/gen-ai-agent-spans.md.
import type { Attributes } from "@opentelemetry/api";
import type { Message } from "@mg/core";
import { jsonAttribute } from "../json.js";
import { receivedMessagesOf } from "../received-messages.js";
import { sentMessagesOf } from "../sent-messages.js";
import type { RecordedSpan } from "../sent-messages.js";
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
  name?: string;
  parts: GenAiPart[];
};

const toParts = (message: Message): GenAiPart[] => {
  switch (message.role) {
    case "system":
    case "user":
      return [{ type: "text", content: message.content }];
    case "assistant":
      return message.parts.map((part): GenAiPart => {
        switch (part.type) {
          case "text":
            return { type: "text", content: part.text };
          case "reasoning":
            return { type: "reasoning", content: part.text };
          case "tool-call":
            return {
              type: "tool_call",
              id: part.id,
              name: part.name,
              arguments: part.arguments,
            };
        }
      });
    case "tool":
      return [
        {
          type: "tool_call_response",
          id: message.toolCallId,
          response: message.content,
        },
      ];
  }
};

const userAuthor = (message: Message): string | undefined => {
  if (message.role !== "user") return undefined;
  const author = message.author;
  if (typeof author !== "string") return undefined;
  if (author.trim() === "") {
    throw new RangeError("user message author must not be blank");
  }
  return author;
};

const toGenAiMessage = (message: Message): GenAiMessage => {
  const author = userAuthor(message);
  return {
    role: message.role,
    ...(author !== undefined ? { name: author } : {}),
    parts: toParts(message),
  };
};

const mapLlmAttributes = (span: RecordedSpan): Attributes => {
  const attributes = span.attributes;
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

  const sent = sentMessagesOf(span);
  if (sent.kind === "messages") {
    mapped[GEN_AI_INPUT_MESSAGES] = jsonAttribute(
      sent.messages.map((m: Message) => toGenAiMessage(m)),
    ); // gen_ai.input.messages
  } else {
    mapped[ATTR.llmInputUnreadable] = sent.reason;
  }

  const received = receivedMessagesOf(span);
  if (received.kind === "messages") {
    mapped[GEN_AI_OUTPUT_MESSAGES] = jsonAttribute(
      received.messages.map((m: Message) => toGenAiMessage(m)),
    ); // gen_ai.output.messages
  } else {
    mapped[ATTR.llmOutputUnreadable] = received.reason;
  }

  return mapped;
};

export const mapGenAiSpan = (span: RecordedSpan): Attributes => {
  const attributes = span.attributes;
  const op = attributes[ATTR.op];
  if (typeof op !== "string") return {};

  const operationName = OPERATION_NAMES[op];
  if (operationName === undefined) return {};

  const mapped: Attributes = {
    [GEN_AI_OPERATION_NAME]: operationName, // gen_ai.operation.name
  };

  if (op === "llm") {
    Object.assign(mapped, mapLlmAttributes(span));
  } else if (op === "tool") {
    const toolName = attributes[ATTR.toolName];
    if (typeof toolName === "string") {
      mapped[GEN_AI_TOOL_NAME] = toolName; // gen_ai.tool.name
    }
  }

  return mapped;
};
