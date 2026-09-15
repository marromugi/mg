import type { SpanNode } from "@mg/trace/store";
import {
  attrNumber,
  attrString,
} from "../../../../hooks/attributes.js";
import { ATTR } from "../../../../vocabulary.js";

export type LlmSpan = {
  model?: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  inputMessages?: string;
  outputMessages?: string;
};

export const useLlmSpan = (node: SpanNode): LlmSpan => ({
  model: attrString(node.attributes, ATTR.llmModel),
  finishReason: attrString(node.attributes, ATTR.llmFinishReason),
  inputTokens: attrNumber(node.attributes, ATTR.llmInputTokens),
  outputTokens: attrNumber(node.attributes, ATTR.llmOutputTokens),
  inputMessages: attrString(node.attributes, ATTR.llmInputMessages),
  outputMessages: attrString(node.attributes, ATTR.llmOutputMessages),
});
