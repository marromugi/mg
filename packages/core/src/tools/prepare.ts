import type { ToolCall } from "../providers/types.js";
import { ToolInputError, ToolNotFoundError } from "./errors.js";
import type { PreparedCall, Tool, ToolContext } from "./types.js";
import { validateToolInput } from "./validate.js";

const failing = (error: Error): PreparedCall<ToolContext> => ({
  reach: { kind: "any-local" },
  run: async () => {
    throw error;
  },
});

export const prepareToolCall = async (
  tools: readonly Tool[],
  call: ToolCall,
): Promise<PreparedCall<ToolContext>> => {
  const tool = tools.find((candidate) => candidate.name === call.name);
  if (!tool) {
    return failing(new ToolNotFoundError(call.id, call.name));
  }

  const result = await validateToolInput(tool.input, call.arguments);
  if (!result.ok) {
    return failing(
      new ToolInputError(call.id, call.name, result.issues),
    );
  }

  return tool.prepare(result.value);
};

export type PrepareToolCall = typeof prepareToolCall;
