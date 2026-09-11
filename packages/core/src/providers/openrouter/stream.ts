import { ProviderHttpError } from "../errors.js";
import type { FinishReason, StreamEvent, Usage } from "../types.js";
import { toFinishReason, toToolCall, toUsage } from "./convert.js";

type OpenRouterChunkToolCall = {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string | null };
};

type OpenRouterChunk = {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: OpenRouterChunkToolCall[] | null;
    } | null;
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
};

type PendingToolCall = { id: string; name: string; arguments: string };

const parseChunk = (payload: string): OpenRouterChunk | null => {
  try {
    return JSON.parse(payload) as OpenRouterChunk | null;
  } catch {
    throw new ProviderHttpError(
      "OpenRouter stream payload is not JSON",
      200,
      payload,
    );
  }
};

export async function* toStreamEvents(
  payloads: AsyncIterable<string>,
): AsyncGenerator<StreamEvent> {
  const pending = new Map<number, PendingToolCall>();
  let finishReason: FinishReason = "other";
  let usage: Usage | undefined;

  for await (const payload of payloads) {
    const chunk = parseChunk(payload);
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta;

    if (typeof delta?.content === "string" && delta.content !== "") {
      yield { type: "text-delta", delta: delta.content };
    }

    for (const fragment of delta?.tool_calls ?? []) {
      let toolCall = pending.get(fragment.index);
      if (toolCall === undefined) {
        toolCall = {
          id: fragment.id ?? "",
          name: fragment.function?.name ?? "",
          arguments: "",
        };
        pending.set(fragment.index, toolCall);
      }
      toolCall.arguments += fragment.function?.arguments ?? "";
    }

    if (choice?.finish_reason !== undefined && choice.finish_reason !== null) {
      finishReason = toFinishReason(choice.finish_reason);
    }

    if (chunk?.usage !== undefined && chunk.usage !== null) {
      usage = toUsage(chunk.usage);
    }
  }

  const indexes = [...pending.keys()].sort((a, b) => a - b);
  for (const index of indexes) {
    const toolCall = pending.get(index)!;
    yield {
      type: "tool-call",
      toolCall: toToolCall({
        id: toolCall.id,
        function: { name: toolCall.name, arguments: toolCall.arguments },
      }),
    };
  }

  yield usage === undefined
    ? { type: "finish", finishReason }
    : { type: "finish", finishReason, usage };
}
