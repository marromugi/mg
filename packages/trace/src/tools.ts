import {
  prepareToolCall,
  runToolCall,
  type PreparedCall,
  type PrepareToolCall,
  type Tool,
  type ToolCall,
  type ToolContext,
  type ToolMessage,
} from "@mg/core";
import { noopSpan, type TraceSpan } from "@mg/harness";
import { jsonAttribute } from "./json.js";
import { endSpan, setSpanAttributes } from "./span-guard.js";
import { ATTR, SPAN } from "./vocabulary.js";

export type RunToolCall = typeof runToolCall;

const startToolSpan = (
  parent: TraceSpan,
  call: ToolCall,
): TraceSpan => {
  try {
    return parent.startSpan(SPAN.tool, {
      [ATTR.op]: "tool",
      [ATTR.toolName]: call.name,
      [ATTR.toolCallId]: call.id,
      [ATTR.toolArguments]: jsonAttribute(call.arguments),
    });
  } catch {
    return noopSpan;
  }
};

const setResultAttribute = (span: TraceSpan, content: string): void => {
  setSpanAttributes(span, { [ATTR.toolResult]: content });
};

export const tracePrepareToolCall = (
  parent: TraceSpan,
  prepare: PrepareToolCall = prepareToolCall,
): PrepareToolCall => {
  return async (
    tools: readonly Tool[],
    call: ToolCall,
  ): Promise<PreparedCall<ToolContext>> => {
    const prepared = await prepare(tools, call);
    return {
      reach: prepared.reach,
      run: async (context) => {
        const span = startToolSpan(parent, call);

        try {
          const content = await prepared.run(context);
          setResultAttribute(span, content);
          endSpan(span);
          return content;
        } catch (error) {
          endSpan(span, error);
          throw error;
        }
      },
    };
  };
};

export const traceRunToolCall = (
  parent: TraceSpan,
  prepare: PrepareToolCall = prepareToolCall,
): RunToolCall => {
  const prepareTraced = tracePrepareToolCall(parent, prepare);
  return async (
    tools: readonly Tool[],
    call: ToolCall,
    context?: ToolContext,
  ): Promise<ToolMessage> => {
    const prepared = await prepareTraced(tools, call);
    const content = await prepared.run(context ?? {});
    return { role: "tool", toolCallId: call.id, content };
  };
};
