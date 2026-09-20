import type { ToolCall, ToolMessage } from "@mg/core";
import {
  noopSpan,
  runSubagentCall,
  type RunSubagentCall,
  type Subagent,
  type SubagentContext,
  type TraceSpan,
} from "@mg/harness";
import { nanoid } from "nanoid";
import { jsonAttribute } from "./json.js";
import { endSpan, setSpanAttributes } from "./span-guard.js";
import { ATTR, SPAN } from "./vocabulary.js";

const startCallSpan = (
  parent: TraceSpan,
  call: ToolCall,
): TraceSpan => {
  try {
    return parent.startSpan(SPAN.subagent, {
      [ATTR.op]: "subagent",
      [ATTR.subagentName]: call.name,
      [ATTR.subagentCallId]: call.id,
      [ATTR.subagentArguments]: jsonAttribute(call.arguments),
    });
  } catch {
    return noopSpan;
  }
};

const startThreadSpan = (
  callSpan: TraceSpan,
  threadId: string,
  subagentName: string,
): TraceSpan => {
  try {
    return callSpan.startRoot(SPAN.thread, {
      [ATTR.op]: "thread",
      [ATTR.threadId]: threadId,
      [ATTR.subagentName]: subagentName,
    });
  } catch {
    return noopSpan;
  }
};

const withThread = (
  subagent: Subagent,
  callSpan: TraceSpan,
  newThreadId: () => string,
): Subagent => ({
  ...subagent,
  start: async (input, context: SubagentContext) => {
    const threadId = newThreadId();
    setSpanAttributes(callSpan, { [ATTR.threadId]: threadId });
    const thread = startThreadSpan(callSpan, threadId, subagent.name);

    try {
      const result = await subagent.start(input, {
        ...context,
        trace: thread,
      });
      endSpan(thread);
      return result;
    } catch (error) {
      endSpan(thread, error);
      throw error;
    }
  },
});

const setResultAttribute = (
  span: TraceSpan,
  message: ToolMessage,
): void => {
  setSpanAttributes(span, { [ATTR.subagentResult]: message.content });
};

export const traceRunSubagentCall = (
  parent: TraceSpan,
  options?: {
    run?: RunSubagentCall;
    newThreadId?: () => string;
  },
): RunSubagentCall => {
  const run = options?.run ?? runSubagentCall;
  const newThreadId = options?.newThreadId ?? nanoid;

  return async (
    subagents: readonly Subagent[],
    call: ToolCall,
    context?: SubagentContext,
  ): Promise<ToolMessage> => {
    const callSpan = startCallSpan(parent, call);
    const wrapped = subagents.map((subagent) =>
      withThread(subagent, callSpan, newThreadId),
    );

    try {
      const message = await run(wrapped, call, context);
      setResultAttribute(callSpan, message);
      endSpan(callSpan);
      return message;
    } catch (error) {
      endSpan(callSpan, error);
      throw error;
    }
  };
};
