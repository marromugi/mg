import { ProviderHttpError } from "../errors.js";
import type { FinishReason, StreamEvent, Usage } from "../types.js";
import { toFinishReason, toToolCall, toUsage } from "./convert.js";
import { PROVIDER_NAME } from "./name.js";

type OpenRouterChunkToolCall = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string } | null;
};

type OpenRouterChunkChoice = {
  delta?: {
    content?: string | null;
    reasoning?: string | null;
    reasoning_details?: unknown[] | null;
    tool_calls?: OpenRouterChunkToolCall[] | null;
  } | null;
  finish_reason?: string | null;
};

type OpenRouterChunk = {
  choices?: OpenRouterChunkChoice[] | null;
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

  return parsed;
};

export async function* toStreamEvents(
  payloads: AsyncIterable<string>,
  halt?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const pending = new Map<number, PendingToolCall>();
  let reasoningDetails: unknown[] = [];
  let finishReason: FinishReason | undefined;
  let usage: Usage | undefined;

  const flushReasoningDetails = function* (): Generator<StreamEvent> {
    if (reasoningDetails.length === 0) {
      return;
    }
    yield {
      type: "reasoning-delta",
      delta: "",
      carry: { provider: PROVIDER_NAME, data: reasoningDetails },
    };
    reasoningDetails = [];
  };

  for await (const payload of payloads) {
    const chunk = parseChunk(payload);
    if (chunk.choices === undefined || chunk.choices === null) {
      throw new ProviderHttpError(
        "OpenRouter stream chunk has no choices",
        200,
        payload,
      );
    }
    const choice = chunk.choices[0];
    const delta = choice?.delta;

    const reasoningText = delta?.reasoning;
    if (typeof reasoningText === "string" && reasoningText !== "") {
      yield { type: "reasoning-delta", delta: reasoningText };
    }

    const detailsFragment = delta?.reasoning_details;
    if (Array.isArray(detailsFragment) && detailsFragment.length > 0) {
      reasoningDetails.push(...detailsFragment);
    }

    const content = delta?.content;
    if (typeof content === "string" && content !== "") {
      yield* flushReasoningDetails();
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

  if (halt?.aborted === true) {
    yield { type: "finish", finishReason: "halted" };
    return;
  }

  yield* flushReasoningDetails();

  const accumulatedCalls = [...pending.entries()].sort(
    ([a], [b]) => a - b,
  );
  for (const [, accumulated] of accumulatedCalls) {
    yield {
      type: "tool-call",
      toolCall: toToolCall({
        id: accumulated.id,
        function: {
          name: accumulated.name,
          arguments: accumulated.arguments,
        },
      }),
    };
  }

  yield {
    type: "finish",
    finishReason: finishReason ?? "other",
    ...(usage !== undefined && { usage }),
  };
}
