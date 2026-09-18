import type { AssistantMessage, Message, Usage } from "@mg/core";
import { textOf } from "@mg/core";
import { ATTR, SPAN } from "@mg/trace";
import type { SessionTree, SpanNode, TraceTree } from "@mg/trace/store";
import { NoRunInSessionError } from "./errors.js";

export type LlmStep = {
  type: "llm";
  spanId: string;
  startTime: string;
  endTime: string;
  model?: string;
  provider?: string;
  finishReason?: string;
  input: Message[];
  output: AssistantMessage[];
  usage?: Usage;
};

export type ToolStep = {
  type: "tool";
  spanId: string;
  startTime: string;
  endTime: string;
  name: string;
  callId?: string;
  arguments: unknown;
  result?: string;
  error?: string;
};

export type GateStep = {
  type: "gate";
  spanId: string;
  startTime: string;
  endTime: string;
  kind: string;
  description: string;
  allowed?: boolean;
  reason?: string;
  probability?: number;
  model?: string;
  error?: string;
};

export type RunStep = LlmStep | ToolStep | GateStep;

export type RunView = {
  sessionId: string;
  runName?: string;
  caseId?: string;
  harnessName?: string;
  steps: RunStep[];
  llmSteps: LlmStep[];
  toolSteps: ToolStep[];
  gateSteps: GateStep[];
  turnCount: number;
  finalText: string | undefined;
  usage: Usage;
  error?: string;
  startTime: string;
  endTime: string;
};

type SpanOp = "run" | "harness" | "llm" | "tool" | "gate";

const SPAN_OPS: readonly SpanOp[] = [
  "run",
  "harness",
  "llm",
  "tool",
  "gate",
];

const SPAN_NAME_TO_OP: Readonly<Record<string, SpanOp>> = {
  [SPAN.run]: "run",
  [SPAN.harness]: "harness",
  [SPAN.llm]: "llm",
  [SPAN.tool]: "tool",
  [SPAN.gate]: "gate",
};

const isSpanOp = (value: unknown): value is SpanOp =>
  typeof value === "string" &&
  (SPAN_OPS as readonly string[]).includes(value);

const classify = (node: SpanNode): SpanOp | undefined => {
  const op = node.attributes[ATTR.op];
  if (isSpanOp(op)) {
    return op;
  }
  return SPAN_NAME_TO_OP[node.name];
};

const STATUS_ERROR_CODE = 2;

const errorOf = (node: SpanNode): string | undefined =>
  node.status.code === STATUS_ERROR_CODE
    ? (node.status.message ?? "error")
    : undefined;

const getString = (
  attributes: SpanNode["attributes"],
  key: string,
): string | undefined => {
  const value = attributes[key];
  return typeof value === "string" ? value : undefined;
};

const getNumber = (
  attributes: SpanNode["attributes"],
  key: string,
): number | undefined => {
  const value = attributes[key];
  return typeof value === "number" ? value : undefined;
};

const getBoolean = (
  attributes: SpanNode["attributes"],
  key: string,
): boolean | undefined => {
  const value = attributes[key];
  return typeof value === "boolean" ? value : undefined;
};

const parseMessageArray = <T>(value: string | undefined): T[] => {
  if (value === undefined) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const parseToolArguments = (value: string | undefined): unknown => {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const toLlmStep = (node: SpanNode): LlmStep => {
  const { attributes } = node;
  const inputTokens = getNumber(attributes, ATTR.llmInputTokens);
  const outputTokens = getNumber(attributes, ATTR.llmOutputTokens);

  return {
    type: "llm",
    spanId: node.spanId,
    startTime: node.startTime,
    endTime: node.endTime,
    model: getString(attributes, ATTR.llmModel),
    provider: getString(attributes, ATTR.llmProvider),
    finishReason: getString(attributes, ATTR.llmFinishReason),
    input: parseMessageArray<Message>(
      getString(attributes, ATTR.llmInputMessages),
    ),
    output: parseMessageArray<AssistantMessage>(
      getString(attributes, ATTR.llmOutputMessages),
    ),
    usage:
      inputTokens !== undefined && outputTokens !== undefined
        ? { inputTokens, outputTokens }
        : undefined,
  };
};

const toToolStep = (node: SpanNode): ToolStep => {
  const { attributes } = node;

  return {
    type: "tool",
    spanId: node.spanId,
    startTime: node.startTime,
    endTime: node.endTime,
    name: getString(attributes, ATTR.toolName) ?? "",
    callId: getString(attributes, ATTR.toolCallId),
    arguments: parseToolArguments(
      getString(attributes, ATTR.toolArguments),
    ),
    result: getString(attributes, ATTR.toolResult),
    error: errorOf(node),
  };
};

const toGateStep = (node: SpanNode): GateStep => {
  const { attributes } = node;

  return {
    type: "gate",
    spanId: node.spanId,
    startTime: node.startTime,
    endTime: node.endTime,
    kind: getString(attributes, ATTR.gateKind) ?? "",
    description: getString(attributes, ATTR.gateDescription) ?? "",
    allowed: getBoolean(attributes, ATTR.gateAllowed),
    reason: getString(attributes, ATTR.gateReason),
    probability: getNumber(attributes, ATTR.gateProbability),
    model: getString(attributes, ATTR.gateModel),
    error: errorOf(node),
  };
};

type WalkState = {
  steps: RunStep[];
  harnessName: string | undefined;
};

const walk = (node: SpanNode, state: WalkState): void => {
  const op = classify(node);

  if (op === "harness" && state.harnessName === undefined) {
    state.harnessName = getString(node.attributes, ATTR.harnessName);
  }

  switch (op) {
    case "llm":
      state.steps.push(toLlmStep(node));
      return;
    case "tool":
      state.steps.push(toToolStep(node));
      return;
    case "gate":
      state.steps.push(toGateStep(node));
      return;
    default:
      for (const child of node.children) {
        walk(child, state);
      }
  }
};

const pickTrace = (
  traces: readonly TraceTree[],
  firstTrace: TraceTree,
): TraceTree =>
  traces.find((trace) => classify(trace.root) === "run") ?? firstTrace;

const isLlmStep = (step: RunStep): step is LlmStep =>
  step.type === "llm";
const isToolStep = (step: RunStep): step is ToolStep =>
  step.type === "tool";
const isGateStep = (step: RunStep): step is GateStep =>
  step.type === "gate";

export const viewRun = (session: SessionTree): RunView => {
  const [firstTrace] = session.traces;
  if (firstTrace === undefined) {
    throw new NoRunInSessionError(session.sessionId);
  }

  const { root } = pickTrace(session.traces, firstTrace);

  const state: WalkState = { steps: [], harnessName: undefined };
  walk(root, state);

  const llmSteps = state.steps.filter(isLlmStep);
  const toolSteps = state.steps.filter(isToolStep);
  const gateSteps = state.steps.filter(isGateStep);

  const lastLlmStep = llmSteps[llmSteps.length - 1];
  const lastOutputMessage =
    lastLlmStep?.output[lastLlmStep.output.length - 1];
  const finalTextCandidate =
    lastOutputMessage === undefined
      ? undefined
      : textOf(lastOutputMessage);
  const finalText =
    finalTextCandidate === undefined || finalTextCandidate === ""
      ? undefined
      : finalTextCandidate;

  const usage = llmSteps.reduce<Usage>(
    (total, step) =>
      step.usage === undefined
        ? total
        : {
            inputTokens: total.inputTokens + step.usage.inputTokens,
            outputTokens: total.outputTokens + step.usage.outputTokens,
          },
    { inputTokens: 0, outputTokens: 0 },
  );

  return {
    sessionId: session.sessionId,
    runName: getString(root.attributes, ATTR.runName),
    caseId: getString(root.attributes, ATTR.runCase),
    harnessName: state.harnessName,
    steps: state.steps,
    llmSteps,
    toolSteps,
    gateSteps,
    turnCount: llmSteps.length,
    finalText,
    usage,
    error: errorOf(root),
    startTime: root.startTime,
    endTime: root.endTime,
  };
};
