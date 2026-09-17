import {
  assistantMessage,
  textOf,
  toolCallsOf,
  type AssistantPart,
  type FinishReason,
  type GenerateRequest,
  type GenerateResponse,
  type Provider,
  type StreamEvent,
  type ToolCall,
  type Usage,
} from "@mg/core";
import {
  noopSpan,
  type TraceAttributes,
  type TraceSpan,
} from "@mg/harness";
import { jsonAttribute } from "./json.js";
import { endSpan, setSpanAttributes } from "./span-guard.js";
import { ATTR, SPAN } from "./vocabulary.js";

export const STREAM_INCOMPLETE_MESSAGE = "stream ended without finish";

const startLlmSpan = (
  parent: TraceSpan,
  provider: Provider,
  request: GenerateRequest,
  stream: boolean,
): TraceSpan => {
  try {
    return parent.startSpan(SPAN.llm, {
      [ATTR.op]: "llm",
      ...(typeof provider.name === "string" && provider.name !== ""
        ? { [ATTR.llmProvider]: provider.name }
        : {}),
      [ATTR.llmModel]: request.model,
      [ATTR.llmStream]: stream,
      [ATTR.llmInputMessages]: jsonAttribute(request.messages),
    });
  } catch {
    return noopSpan;
  }
};

const partsOfOutcome = (
  content: string,
  toolCalls: readonly ToolCall[],
): AssistantPart[] => {
  const parts: AssistantPart[] = [];
  if (content !== "") {
    parts.push({ type: "text", text: content });
  }
  for (const toolCall of toolCalls) {
    parts.push({ type: "tool-call", ...toolCall });
  }
  return parts;
};

const setOutputAttributes = (
  span: TraceSpan,
  outcome: {
    content: string;
    toolCalls: ToolCall[];
    finishReason?: FinishReason;
    usage?: Usage;
  },
): void => {
  const message = assistantMessage(
    partsOfOutcome(outcome.content, outcome.toolCalls),
  );

  const attributes: TraceAttributes = {
    ...(outcome.finishReason !== undefined
      ? { [ATTR.llmFinishReason]: outcome.finishReason }
      : {}),
    [ATTR.llmOutputMessages]: jsonAttribute([message]),
    ...(outcome.usage !== undefined
      ? {
          [ATTR.llmInputTokens]: outcome.usage.inputTokens,
          [ATTR.llmOutputTokens]: outcome.usage.outputTokens,
        }
      : {}),
  };

  setSpanAttributes(span, attributes);
};

const traceGenerate = async (
  provider: Provider,
  parent: TraceSpan,
  request: GenerateRequest,
): Promise<GenerateResponse> => {
  const span = startLlmSpan(parent, provider, request, false);

  try {
    const response = await provider.generate(request);
    setOutputAttributes(span, {
      content: textOf(response),
      toolCalls: toolCallsOf(response),
      finishReason: response.finishReason,
      usage: response.usage,
    });
    endSpan(span);
    return response;
  } catch (error) {
    endSpan(span, error);
    throw error;
  }
};

async function* traceStream(
  provider: Provider,
  parent: TraceSpan,
  request: GenerateRequest,
): AsyncGenerator<StreamEvent, void, unknown> {
  const span = startLlmSpan(parent, provider, request, true);

  let content = "";
  const toolCalls: ToolCall[] = [];
  let finishReason: FinishReason | undefined;
  let usage: Usage | undefined;
  let finished = false;
  let ended = false;

  try {
    for await (const event of provider.stream(request)) {
      if (event.type === "text-delta") {
        content += event.delta;
      } else if (event.type === "tool-call") {
        toolCalls.push(event.toolCall);
      } else if (event.type === "finish") {
        finished = true;
        finishReason = event.finishReason;
        usage = event.usage;
      }
      yield event;
    }

    ended = true;
    setOutputAttributes(span, {
      content,
      toolCalls,
      finishReason,
      usage,
    });
    endSpan(
      span,
      finished ? undefined : new Error(STREAM_INCOMPLETE_MESSAGE),
    );
  } catch (error) {
    ended = true;
    endSpan(span, error);
    throw error;
  } finally {
    if (!ended) {
      endSpan(span);
    }
  }
}

export const traceProvider = (
  provider: Provider,
  parent: TraceSpan,
): Provider => ({
  name: provider.name,
  generate: (request: GenerateRequest): Promise<GenerateResponse> =>
    traceGenerate(provider, parent, request),
  stream: (request: GenerateRequest): AsyncIterable<StreamEvent> =>
    traceStream(provider, parent, request),
});
