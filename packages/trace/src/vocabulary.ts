export const SPAN = {
  harness: "mg.harness",
  llm: "mg.llm",
  tool: "mg.tool",
  run: "mg.run",
  gate: "mg.gate",
  workspace: "mg.workspace",
  subagent: "mg.subagent",
  thread: "mg.thread",
  input: "mg.input",
  trigger: "mg.trigger",
} as const;

export const ATTR = {
  op: "mg.op", // "harness" | "llm" | "tool" | "run" | "gate" | "workspace" | "subagent" | "thread" | "input" | "trigger"
  harnessName: "mg.harness.name",
  runName: "mg.run.name", // RunConfig.name
  runCase: "mg.run.case", // case id when run through runMany
  runSession: "mg.run.session", // session id of the started run, written on the input span
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
  subagentName: "mg.subagent.name",
  subagentCallId: "mg.subagent.call_id",
  subagentArguments: "mg.subagent.arguments", // jsonAttribute(unknown)
  subagentResult: "mg.subagent.result", // string
  threadId: "mg.thread.id",
  inputValue: "mg.input.value", // jsonAttribute(unknown)
  triggerFired: "mg.trigger.fired", // boolean
  triggerReason: "mg.trigger.reason",
  triggerModel: "mg.trigger.model",
  triggerProbability: "mg.trigger.probability", // number
  triggerThreshold: "mg.trigger.threshold", // number
} as const;
