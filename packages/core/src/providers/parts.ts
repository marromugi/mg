import type {
  AssistantMessage,
  AssistantPart,
  GenerateResponse,
  ReasoningPart,
  TextPart,
  ToolCall,
  ToolCallPart,
} from "./types.js";

export type {
  AssistantPart,
  ReasoningCarry,
  ReasoningPart,
  TextPart,
  ToolCallPart,
} from "./types.js";

type PartSource = AssistantMessage | GenerateResponse;

export const assistantMessage = (
  parts: readonly AssistantPart[],
): AssistantMessage => ({
  role: "assistant",
  parts: parts.filter(
    (part) => part.type !== "text" || part.text !== "",
  ),
});

export const partsOf = (source: PartSource): AssistantPart[] => [
  ...source.parts,
];

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
