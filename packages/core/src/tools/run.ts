import type { ToolCall, ToolMessage } from "../providers/types.js";
import { prepareToolCall } from "./prepare.js";
import type { Tool, ToolContext } from "./types.js";

export const runToolCall = async (
  tools: readonly Tool[],
  call: ToolCall,
  context?: ToolContext,
): Promise<ToolMessage> => {
  const prepared = await prepareToolCall(tools, call);
  const content = await prepared.run(context ?? {});
  return { role: "tool", toolCallId: call.id, content };
};
