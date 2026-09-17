import type {
  AssistantMessage,
  GenerateResponse,
  ToolCall,
} from "./types.js";

export type ReasoningCarry = { provider: string; data: unknown };
export type TextPart = { type: "text"; text: string };
export type ReasoningPart = {
  type: "reasoning";
  text: string;
  carry?: ReasoningCarry;
};
export type ToolCallPart = { type: "tool-call" } & ToolCall;
export type AssistantPart = TextPart | ReasoningPart | ToolCallPart;

type PartSource = AssistantMessage | GenerateResponse;

export const assistantMessage = (
  parts: readonly AssistantPart[],
): AssistantMessage => {
  const text = parts
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("");
  const toolCalls = parts
    .filter((part): part is ToolCallPart => part.type === "tool-call")
    .map(({ id, name, arguments: args }) => ({
      id,
      name,
      arguments: args,
    }));

  return {
    role: "assistant",
    content: text,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
};

export const partsOf = (source: PartSource): AssistantPart[] => {
  const parts: AssistantPart[] = [];
  if (source.content !== "") {
    parts.push({ type: "text", text: source.content });
  }
  for (const toolCall of source.toolCalls ?? []) {
    parts.push({ type: "tool-call", ...toolCall });
  }
  return parts;
};

export const textOf = (source: PartSource): string =>
  partsOf(source)
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("");

export const toolCallsOf = (source: PartSource): ToolCall[] =>
  partsOf(source)
    .filter((part): part is ToolCallPart => part.type === "tool-call")
    .map(({ id, name, arguments: args }) => ({
      id,
      name,
      arguments: args,
    }));

export const reasoningOf = (source: PartSource): string =>
  partsOf(source)
    .filter((part): part is ReasoningPart => part.type === "reasoning")
    .map((part) => part.text)
    .join("\n");
