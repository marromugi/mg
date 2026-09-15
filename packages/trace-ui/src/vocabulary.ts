// Mirrors packages/trace/src/vocabulary.ts. Duplicated here because trace-ui
// may only depend on @mg/trace/store, not the @mg/trace root entry.
export const SPAN = {
  harness: "mg.harness",
  llm: "mg.llm",
  tool: "mg.tool",
  run: "mg.run",
} as const;

export const ATTR = {
  llmModel: "mg.llm.model",
  llmFinishReason: "mg.llm.finish_reason",
  llmInputTokens: "mg.llm.usage.input_tokens",
  llmOutputTokens: "mg.llm.usage.output_tokens",
  llmInputMessages: "mg.llm.messages.input",
  llmOutputMessages: "mg.llm.messages.output",
  toolName: "mg.tool.name",
  toolArguments: "mg.tool.arguments",
  toolResult: "mg.tool.result",
} as const;
