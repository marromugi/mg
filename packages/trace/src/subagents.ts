import type { PreparedCall, ToolCall, ToolMessage } from "@mg/core";
import {
  noopSpan,
  prepareSubagentCall,
  type PrepareSubagentCall,
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

// Wraps each subagent's preparation so its prepared call runs under a
// thread span. An unknown name or invalid input never reaches a
// subagent, so it gets no thread.
const withThread = (
  subagent: Subagent,
  callSpan: () => TraceSpan,
  newThreadId: () => string,
): Subagent => ({
  ...subagent,
  prepare: async (input) => {
    const prepared = await subagent.prepare(input);
    return {
      reach: prepared.reach,
      run: async (context: SubagentContext) => {
        const threadId = newThreadId();
        const parent = callSpan();
        setSpanAttributes(parent, { [ATTR.threadId]: threadId });
        const thread = startThreadSpan(parent, threadId, subagent.name);

        try {
          const result = await prepared.run({
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
    };
  },
});

const setResultAttribute = (span: TraceSpan, content: string): void => {
  setSpanAttributes(span, { [ATTR.subagentResult]: content });
};

type TraceSubagentOptions = {
  prepare?: PrepareSubagentCall;
  newThreadId?: () => string;
};

export const tracePrepareSubagentCall = (
  parent: TraceSpan,
  options?: TraceSubagentOptions,
): PrepareSubagentCall => {
  const prepare = options?.prepare ?? prepareSubagentCall;
  const newThreadId = options?.newThreadId ?? nanoid;

  return async (
    subagents: readonly Subagent[],
    call: ToolCall,
  ): Promise<PreparedCall<SubagentContext>> => {
    let callSpan: TraceSpan = noopSpan;
    const wrapped = subagents.map((subagent) =>
      withThread(subagent, () => callSpan, newThreadId),
    );
    const prepared = await prepare(wrapped, call);
    return {
      reach: prepared.reach,
      run: async (context) => {
        callSpan = startCallSpan(parent, call);
        try {
          const content = await prepared.run(context);
          setResultAttribute(callSpan, content);
          endSpan(callSpan);
          return content;
        } catch (error) {
          endSpan(callSpan, error);
          throw error;
        }
      },
    };
  };
};

export const traceRunSubagentCall = (
  parent: TraceSpan,
  options?: TraceSubagentOptions,
): RunSubagentCall => {
  const prepare = tracePrepareSubagentCall(parent, options);

  return async (
    subagents: readonly Subagent[],
    call: ToolCall,
    context?: SubagentContext,
  ): Promise<ToolMessage> => {
    const prepared = await prepare(subagents, call);
    const content = await prepared.run(context ?? {});
    return { role: "tool", toolCallId: call.id, content };
  };
};
