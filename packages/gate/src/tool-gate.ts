import {
  prepareToolCall,
  type Callee,
  type PreparedCall,
  type Reach,
  type Tool,
  type ToolCall,
  type ToolContext,
  type ToolDefinition,
  type ToolMessage,
} from "@mg/core";
import type { TraceSpan } from "@mg/harness";
import { isAbortError } from "./abort.js";
import { GateError } from "./errors.js";
import type { Gate, GateRequest, Verdict } from "./types.js";

export const TOOL_CALL_KIND = "tool-call";

export type ToolCallPayload = {
  call: ToolCall;
  tool?: ToolDefinition;
  reach: Reach;
};

const toToolDefinition = (tool: ToolDefinition): ToolDefinition => ({
  name: tool.name,
  description: tool.description,
  input: tool.input,
});

const describeToolCall = (
  call: ToolCall,
  tool?: ToolDefinition,
): string => {
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
  callees: readonly ToolDefinition[],
  call: ToolCall,
  reach: Reach,
): GateRequest => {
  const callee = callees.find(
    (candidate) => candidate.name === call.name,
  );
  const payload: ToolCallPayload = {
    call,
    tool: callee === undefined ? undefined : toToolDefinition(callee),
    reach,
  };
  return {
    kind: TOOL_CALL_KIND,
    description: describeToolCall(call, callee),
    payload,
  };
};

const deniedMessage = (reason: string): string =>
  `[denied] Not executed. The policy gate rejected this action: ${reason}`;

const failedMessage = (message: string): string =>
  `[denied] Not executed. The policy check failed: ${message}`;

const toErrorMessage = (error: unknown): string =>
  error instanceof GateError
    ? error.callerMessage
    : error instanceof Error
      ? error.message
      : String(error);

type PrepareCallee<TCallee extends Callee, TContext> = (
  callees: readonly TCallee[],
  call: ToolCall,
) => Promise<PreparedCall<TContext>>;

type RunCallee<TCallee extends Callee, TContext> = (
  callees: readonly TCallee[],
  call: ToolCall,
  context?: TContext,
) => Promise<ToolMessage>;

export function gateRunToolCall(
  gate: Gate,
  prepare?: undefined,
  parent?: TraceSpan,
): RunCallee<Tool, ToolContext>;
export function gateRunToolCall<
  TCallee extends Callee,
  TContext extends { signal?: AbortSignal },
>(
  gate: Gate,
  prepare: PrepareCallee<TCallee, TContext>,
  parent?: TraceSpan,
): RunCallee<TCallee, TContext>;
export function gateRunToolCall<
  TCallee extends Callee = Tool,
  TContext extends { signal?: AbortSignal } = ToolContext,
>(
  gate: Gate,
  prepare: PrepareCallee<TCallee, TContext> = prepareToolCall,
  parent?: TraceSpan,
): RunCallee<TCallee, TContext> {
  return async (
    callees: readonly TCallee[],
    call: ToolCall,
    context?: TContext,
  ): Promise<ToolMessage> => {
    let prepared: PreparedCall<TContext>;
    let verdict: Verdict;
    try {
      prepared = await prepare(callees, call);
      const request = toToolCallRequest(callees, call, prepared.reach);
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

    const content = await prepared.run(context ?? ({} as TContext));
    return { role: "tool", toolCallId: call.id, content };
  };
}
