export const SPAN = {
  harness: "mg.harness",
  llm: "mg.llm",
  tool: "mg.tool",
} as const;

export const ATTR = {
  op: "mg.op", // "harness" | "llm" | "tool"
  harnessName: "mg.harness.name",
  llmModel: "mg.llm.model",
  llmStream: "mg.llm.stream", // boolean
  llmFinishReason: "mg.llm.finish_reason",
  llmInputTokens: "mg.llm.usage.input_tokens",
  llmOutputTokens: "mg.llm.usage.output_tokens",
  llmInputMessages: "mg.llm.messages.input", // jsonAttribute(Message[])
  llmOutputMessages: "mg.llm.messages.output", // jsonAttribute(AssistantMessage[])
  toolName: "mg.tool.name",
  toolCallId: "mg.tool.call_id",
  toolArguments: "mg.tool.arguments", // jsonAttribute(unknown)
  toolResult: "mg.tool.result", // string
} as const;
