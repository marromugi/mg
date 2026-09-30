import type {
  Callee,
  PreparedCall,
  ToolCall,
  ToolMessage,
  ToolSchema,
} from "@mg/core";
import { validateToolInput } from "@mg/core";
import {
  SubagentInputError,
  SubagentNotFoundError,
} from "./subagent-errors.js";
import type { HoldSignal } from "./hold.js";
import type { TraceSpan } from "./trace.js";

export type SubagentContext = {
  signal?: AbortSignal;
  wrapUp?: AbortSignal;
  hold?: HoldSignal;
  trace?: TraceSpan;
};

export type Subagent<TInput extends ToolSchema = ToolSchema> = Callee<
  TInput,
  SubagentContext
>;

const failing = (error: Error): PreparedCall<SubagentContext> => ({
  reach: { kind: "any-local" },
  run: async () => {
    throw error;
  },
});

export const prepareSubagentCall = async (
  subagents: readonly Subagent[],
  call: ToolCall,
): Promise<PreparedCall<SubagentContext>> => {
  const subagent = subagents.find(
    (candidate) => candidate.name === call.name,
  );
  if (!subagent) {
    return failing(new SubagentNotFoundError(call.id, call.name));
  }

  const result = await validateToolInput(
    subagent.input,
    call.arguments,
  );
  if (!result.ok) {
    return failing(
      new SubagentInputError(call.id, call.name, result.issues),
    );
  }

  return subagent.prepare(result.value);
};

export type PrepareSubagentCall = typeof prepareSubagentCall;

export const runSubagentCall = async (
  subagents: readonly Subagent[],
  call: ToolCall,
  context?: SubagentContext,
): Promise<ToolMessage> => {
  const prepared = await prepareSubagentCall(subagents, call);
  const content = await prepared.run(context ?? {});
  return { role: "tool", toolCallId: call.id, content };
};

export type RunSubagentCall = typeof runSubagentCall;
