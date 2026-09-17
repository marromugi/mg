import { ProviderHttpError } from "../errors.js";
import type { StreamEvent } from "../types.js";
import { toFinishReason, toToolCall, toUsage } from "./convert.js";

type OllamaStreamToolCall = {
  id?: string;
  function?: { name?: string; arguments?: unknown };
};

type OllamaStreamMessage = {
  content?: string;
  thinking?: string;
  tool_calls?: OllamaStreamToolCall[] | null;
};

type OllamaStreamChunk = {
  message?: OllamaStreamMessage | null;
  done?: boolean;
  done_reason?: string | null;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
};

const parseLine = (line: string): OllamaStreamChunk => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (cause) {
    throw new ProviderHttpError(
      "Ollama stream chunk is not JSON",
      200,
      line,
      { cause },
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new ProviderHttpError(
      "Ollama stream chunk is not JSON",
      200,
      line,
    );
  }

  const chunk = parsed as OllamaStreamChunk;
  if (typeof chunk.error === "string") {
    throw new ProviderHttpError("Ollama stream failed", 200, line);
  }

  return chunk;
};

export async function* toStreamEvents(
  lines: AsyncIterable<string>,
): AsyncGenerator<StreamEvent> {
  let toolCallCount = 0;
  let sawToolCall = false;

  for await (const line of lines) {
    const chunk = parseLine(line);

    const content = chunk.message?.content;
    if (typeof content === "string" && content !== "") {
      yield { type: "text-delta", delta: content };
    }

    for (const toolCall of chunk.message?.tool_calls ?? []) {
      sawToolCall = true;
      yield {
        type: "tool-call",
        toolCall: toToolCall(toolCall, toolCallCount),
      };
      toolCallCount += 1;
    }

    if (chunk.done === true) {
      const usage = toUsage(chunk);
      yield {
        type: "finish",
        finishReason: toFinishReason(chunk.done_reason, sawToolCall),
        ...(usage !== undefined && { usage }),
      };
      return;
    }
  }

  yield { type: "finish", finishReason: "other" };
}
