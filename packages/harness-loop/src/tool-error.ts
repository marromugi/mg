import type { ToolCall, ToolMessage } from "@mg/core";
import { ToolInputError } from "@mg/core";
import { SubagentInputError } from "@mg/harness";

export const toolErrorToMessage = (
  call: ToolCall,
  error: unknown,
): ToolMessage => {
  if (!(error instanceof Error)) {
    return {
      role: "tool",
      toolCallId: call.id,
      content: `[error] ${String(error)}`,
    };
  }

  let content = `[${error.name}] ${error.message}`;
  if (
    error instanceof ToolInputError ||
    error instanceof SubagentInputError
  ) {
    content += `\n${error.issues.map((issue) => `- ${issue.message}`).join("\n")}`;
  }

  return { role: "tool", toolCallId: call.id, content };
};
