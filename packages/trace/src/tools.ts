import {
  runToolCall,
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

const startToolSpan = (parent: TraceSpan, call: ToolCall): TraceSpan => {
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

const setResultAttribute = (span: TraceSpan, message: ToolMessage): void => {
  setSpanAttributes(span, { [ATTR.toolResult]: message.content });
};

export const traceRunToolCall = (
  parent: TraceSpan,
  run: RunToolCall = runToolCall,
): RunToolCall => {
  return async (
    tools: readonly Tool[],
    call: ToolCall,
    context?: ToolContext,
  ): Promise<ToolMessage> => {
    const span = startToolSpan(parent, call);

    try {
      const message = await run(tools, call, context);
      setResultAttribute(span, message);
      endSpan(span);
      return message;
    } catch (error) {
      endSpan(span, error);
      throw error;
    }
  };
};
