import { ProviderHttpError } from "../errors.js";
import type { FinishReason, StreamEvent, Usage } from "../types.js";
import { toFinishReason, toToolCall, toUsage } from "./convert.js";

type OpenRouterChunkToolCall = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string } | null;
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

const parseChunk = (payload: string): OpenRouterChunk => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (cause) {
    throw new ProviderHttpError(
      "OpenRouter stream chunk is not JSON",
      200,
      payload,
      { cause },
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new ProviderHttpError(
      "OpenRouter stream chunk is not JSON",
      200,
      payload,
    );
  }

  return parsed as OpenRouterChunk;
};

export async function* toStreamEvents(
  payloads: AsyncIterable<string>,
): AsyncGenerator<StreamEvent> {
  const pending = new Map<number, PendingToolCall>();
  let finishReason: FinishReason | undefined;
  let usage: Usage | undefined;

  for await (const payload of payloads) {
    const chunk = parseChunk(payload);
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;

    const content = delta?.content;
    if (typeof content === "string" && content !== "") {
      yield { type: "text-delta", delta: content };
    }

    for (const fragment of delta?.tool_calls ?? []) {
      const index = fragment.index ?? 0;
      let toolCall = pending.get(index);
      if (toolCall === undefined) {
        toolCall = {
          id: fragment.id ?? "",
          name: fragment.function?.name ?? "",
          arguments: "",
        };
        pending.set(index, toolCall);
      }
      toolCall.arguments += fragment.function?.arguments ?? "";
    }

    const reason = choice?.finish_reason;
    if (reason !== undefined && reason !== null) {
      finishReason = toFinishReason(reason);
    }

    if (chunk.usage !== undefined && chunk.usage !== null) {
      usage = toUsage(chunk.usage);
    }
  }

  const indexes = [...pending.keys()].sort((left, right) => left - right);
  for (const index of indexes) {
    const accumulated = pending.get(index)!;
    yield {
      type: "tool-call",
      toolCall: toToolCall({
        id: accumulated.id,
        function: { name: accumulated.name, arguments: accumulated.arguments },
      }),
    };
  }

  if (usage === undefined) {
    yield { type: "finish", finishReason: finishReason ?? "other" };
    return;
  }
  yield { type: "finish", finishReason: finishReason ?? "other", usage };
}
