import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
  ToolCall,
  ToolDefinition,
  ToolMessage,
  ToolSchema,
} from "@mg/core";
import {
  SubagentInputError,
  SubagentNotFoundError,
} from "./subagent-errors.js";
import type { TraceSpan } from "./trace.js";

export type SubagentContext = {
  signal?: AbortSignal;
  trace?: TraceSpan;
};

export type Subagent<TInput extends ToolSchema = ToolSchema> =
  ToolDefinition<TInput> & {
    // method syntax on purpose: keeps Subagent<Specific> assignable to Subagent
    start(
      input: StandardSchemaV1.InferOutput<TInput>,
      context: SubagentContext,
    ): Promise<string>;
  };

export const runSubagentCall = async (
  subagents: readonly Subagent[],
  call: ToolCall,
  context?: SubagentContext,
): Promise<ToolMessage> => {
  const subagent = subagents.find(
    (candidate) => candidate.name === call.name,
  );
  if (!subagent) {
    throw new SubagentNotFoundError(call.id, call.name);
  }

  const result = await subagent.input["~standard"].validate(
    call.arguments,
  );
  if (result.issues) {
    throw new SubagentInputError(call.id, call.name, result.issues);
  }

  const content = await subagent.start(result.value, context ?? {});
  return { role: "tool", toolCallId: call.id, content };
};

export type RunSubagentCall = typeof runSubagentCall;
