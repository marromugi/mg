import type { ToolCall, ToolMessage } from "../providers/types.js";
import { ToolInputError, ToolNotFoundError } from "./errors.js";
import type { Tool, ToolContext } from "./types.js";
import { validateToolInput } from "./validate.js";

export const runToolCall = async (
  tools: readonly Tool[],
  call: ToolCall,
  context?: ToolContext,
): Promise<ToolMessage> => {
  const tool = tools.find((candidate) => candidate.name === call.name);
  if (!tool) {
    throw new ToolNotFoundError(call.id, call.name);
  }

  const result = await validateToolInput(tool.input, call.arguments);
  if (!result.ok) {
    throw new ToolInputError(call.id, call.name, result.issues);
  }

  const content = await tool.execute(result.value, context ?? {});
  return { role: "tool", toolCallId: call.id, content };
};
