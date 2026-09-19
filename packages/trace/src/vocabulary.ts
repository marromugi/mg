export const SPAN = {
  harness: "mg.harness",
  llm: "mg.llm",
  tool: "mg.tool",
  run: "mg.run",
  gate: "mg.gate",
  workspace: "mg.workspace",
} as const;

export const ATTR = {
  op: "mg.op", // "harness" | "llm" | "tool" | "run" | "gate" | "workspace"
  harnessName: "mg.harness.name",
  runName: "mg.run.name", // RunConfig.name
  runCase: "mg.run.case", // case id when run through runMany
  workspaceName: "mg.workspace.name",
  workspaceConnectors: "mg.workspace.connectors", // jsonAttribute(string[])
  workspaceTools: "mg.workspace.tools", // jsonAttribute(string[])
  llmModel: "mg.llm.model",
  llmProvider: "mg.llm.provider",
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
  gateKind: "mg.gate.kind",
  gateDescription: "mg.gate.description",
  gateAllowed: "mg.gate.allowed", // boolean
  gateReason: "mg.gate.reason",
  gateModel: "mg.gate.model",
  gateProbability: "mg.gate.probability", // number
} as const;
