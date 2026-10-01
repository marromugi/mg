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
  persona: "mg.persona",
  recall: "mg.recall",
  reflection: "mg.reflection",
  turn: "mg.turn",
  dialogue: "mg.dialogue",
  dialogueRun: "mg.dialogue.run",
} as const;

export const EVENT = {
  llmSystem: "mg.llm.system",
  llmRetry: "mg.llm.retry",
} as const;

export const ATTR = {
  op: "mg.op", // "harness" | "llm" | "tool" | "run" | "gate" | "workspace" | "subagent" | "thread" | "input" | "trigger" | "persona" | "recall" | "reflection" | "turn" | "dialogue" | "dialogue.run"
  harnessName: "mg.harness.name",
  harnessStopReason: "mg.harness.stop_reason", // HarnessStopReason
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
  llmSystemContent: "mg.llm.system.content", // string, on an EVENT.llmSystem event
  llmSystemIndex: "mg.llm.system.index", // number, position in the sent list, on an EVENT.llmSystem event
  llmSystemCount: "mg.llm.system.count", // number of system messages sent
  llmInputUnreadable: "mg.llm.messages.input.unreadable", // why the sent messages cannot be rebuilt
  llmOutputMessages: "mg.llm.messages.output", // jsonAttribute(AssistantMessage[])
  llmOutputUnreadable: "mg.llm.messages.output.unreadable", // why the received messages cannot be rebuilt
  llmRetryAttempt: "mg.llm.retry.attempt", // number, from 1, on an EVENT.llmRetry event
  llmRetryReason: "mg.llm.retry.reason", // the failed attempt's error message, on an EVENT.llmRetry event
  llmRetryWaitMs: "mg.llm.retry.wait_ms", // number, the wait before the next attempt, on an EVENT.llmRetry event
  llmOmitted: "mg.llm.omitted", // jsonAttribute(Omission[]), what the provider reports it could not give back
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
  personaId: "mg.persona.id",
  personaConversation: "mg.persona.conversation",
  personaCounterparts: "mg.persona.counterparts", // jsonAttribute(string[])
  personaSaved: "mg.persona.saved", // boolean
  personaUpdated: "mg.persona.updated", // boolean
  personaReferenced: "mg.persona.referenced", // boolean
  recallModel: "mg.recall.model",
  recallCandidates: "mg.recall.candidates", // number
  recallSelected: "mg.recall.selected", // jsonAttribute(string[])
  recallProbabilities: "mg.recall.probabilities", // jsonAttribute(Record<string, number>)
  reflectionModel: "mg.reflection.model",
  reflectionCandidates: "mg.reflection.candidates", // number
  reflectionKept: "mg.reflection.kept", // number
  reflectionPersonaChanged: "mg.reflection.persona_changed", // boolean
  reflectionForgotten: "mg.reflection.forgotten", // jsonAttribute(string[])
  turnJudge: "mg.turn.judge", // JudgeName
  turnModel: "mg.turn.model",
  turnLabel: "mg.turn.label",
  turnProbabilities: "mg.turn.probabilities", // jsonAttribute(Record<string, number>)
  dialogueRole: "mg.dialogue.role", // "talker" | "worker"
} as const;
