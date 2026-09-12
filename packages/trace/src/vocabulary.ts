export const SPAN = {
  harness: "mg.harness",
  llm: "mg.llm",
  tool: "mg.tool",
  run: "mg.run",
} as const;

export const ATTR = {
  op: "mg.op", // "harness" | "llm" | "tool" | "run"
  harnessName: "mg.harness.name",
  runName: "mg.run.name", // RunConfig.name
  runCase: "mg.run.case", // case id when run through runMany
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
