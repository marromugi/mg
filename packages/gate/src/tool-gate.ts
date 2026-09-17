import {
  runToolCall,
  type Tool,
  type ToolCall,
  type ToolContext,
  type ToolDefinition,
  type ToolMessage,
} from "@mg/core";
import type { TraceSpan } from "@mg/harness";
import type { RunToolCall } from "@mg/trace";
import { isAbortError } from "./abort.js";
import type { Gate, GateRequest, Verdict } from "./types.js";

export const TOOL_CALL_KIND = "tool-call";

export type ToolCallPayload = {
  call: ToolCall;
  tool?: ToolDefinition;
};

const toToolDefinition = (tool: Tool): ToolDefinition => ({
  name: tool.name,
  description: tool.description,
  input: tool.input,
});

const describeToolCall = (call: ToolCall, tool?: Tool): string => {
  const description =
    tool === undefined
      ? "(unknown tool)"
      : (tool.description ?? "(none)");
  return [
    `Tool: ${call.name}`,
    `Description: ${description}`,
    "Arguments:",
    JSON.stringify(call.arguments, null, 2),
  ].join("\n");
};

export const toToolCallRequest = (
  tools: readonly Tool[],
  call: ToolCall,
): GateRequest => {
  const tool = tools.find((candidate) => candidate.name === call.name);
  const payload: ToolCallPayload = {
    call,
    tool: tool === undefined ? undefined : toToolDefinition(tool),
  };
  return {
    kind: TOOL_CALL_KIND,
    description: describeToolCall(call, tool),
    payload,
  };
};

const deniedMessage = (reason: string): string =>
  `[denied] Not executed. The policy gate rejected this action: ${reason}`;

const failedMessage = (message: string): string =>
  `[denied] Not executed. The policy check failed: ${message}`;

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const gateRunToolCall = (
  gate: Gate,
  run: RunToolCall = runToolCall,
  parent?: TraceSpan,
): RunToolCall => {
  return async (
    tools: readonly Tool[],
    call: ToolCall,
    context?: ToolContext,
  ): Promise<ToolMessage> => {
    const request = toToolCallRequest(tools, call);

    let verdict: Verdict;
    try {
      verdict = await gate.judge(request, {
        signal: context?.signal,
        ...(parent === undefined ? {} : { trace: parent }),
      });
    } catch (error) {
      if (isAbortError(error) || context?.signal?.aborted === true) {
        throw error;
      }
      return {
        role: "tool",
        toolCallId: call.id,
        content: failedMessage(toErrorMessage(error)),
      };
    }

    if (!verdict.allowed) {
      return {
        role: "tool",
        toolCallId: call.id,
        content: deniedMessage(verdict.reason),
      };
    }

    return run(tools, call, context);
  };
};
