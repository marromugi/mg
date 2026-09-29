import {
  runToolCall,
  type Callee,
  type Reach,
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

export const toToolCallRequest = async (
  callees: readonly Callee[],
  call: ToolCall,
): Promise<GateRequest> => {
  const callee = callees.find(
    (candidate) => candidate.name === call.name,
  );
  const reach: Reach =
    callee === undefined
      ? { kind: "any-local" }
      : await callee.reach(call.arguments);
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
  error instanceof Error ? error.message : String(error);

type RunCallee<TCallee extends Callee, TContext> = (
  callees: readonly TCallee[],
  call: ToolCall,
  context?: TContext,
) => Promise<ToolMessage>;

export function gateRunToolCall(
  gate: Gate,
  run?: RunToolCall,
  parent?: TraceSpan,
): RunToolCall;
export function gateRunToolCall<
  TCallee extends Callee,
  TContext extends { signal?: AbortSignal },
>(
  gate: Gate,
  run: RunCallee<TCallee, TContext>,
  parent?: TraceSpan,
): RunCallee<TCallee, TContext>;
export function gateRunToolCall<
  TCallee extends Callee = Tool,
  TContext extends { signal?: AbortSignal } = ToolContext,
>(
  gate: Gate,
  run: RunCallee<
    TCallee,
    TContext
  > = runToolCall as unknown as RunCallee<TCallee, TContext>,
  parent?: TraceSpan,
): RunCallee<TCallee, TContext> {
  return async (
    callees: readonly TCallee[],
    call: ToolCall,
    context?: TContext,
  ): Promise<ToolMessage> => {
    let verdict: Verdict;
    try {
      const request = await toToolCallRequest(callees, call);
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

    return run(callees, call, context);
  };
}
