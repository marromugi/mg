import type {
  AssistantMessage,
  FinishReason,
  GenerateRequest,
  GenerateResponse,
  Provider,
  StreamEvent,
  ToolCall,
  Usage,
} from "@mg/core";
import { noopSpan, type TraceAttributes, type TraceSpan } from "@mg/harness";
import { jsonAttribute } from "./json.js";
import { ATTR, SPAN } from "./vocabulary.js";

const startLlmSpan = (
  parent: TraceSpan,
  request: GenerateRequest,
  stream: boolean,
): TraceSpan => {
  try {
    return parent.startSpan(SPAN.llm, {
      [ATTR.op]: "llm",
      [ATTR.llmModel]: request.model,
      [ATTR.llmStream]: stream,
      [ATTR.llmInputMessages]: jsonAttribute(request.messages),
    });
  } catch {
    return noopSpan;
  }
};

const setOutputAttributes = (
  span: TraceSpan,
  outcome: {
    content: string;
    toolCalls: ToolCall[];
    finishReason: FinishReason;
    usage?: Usage;
  },
): void => {
  const message: AssistantMessage = {
    role: "assistant",
    content: outcome.content,
    toolCalls: outcome.toolCalls,
  };

  const attributes: TraceAttributes = {
    [ATTR.llmFinishReason]: outcome.finishReason,
    [ATTR.llmOutputMessages]: jsonAttribute([message]),
    ...(outcome.usage !== undefined
      ? {
          [ATTR.llmInputTokens]: outcome.usage.inputTokens,
          [ATTR.llmOutputTokens]: outcome.usage.outputTokens,
        }
      : {}),
  };

  try {
    span.setAttributes(attributes);
  } catch {
  }
};

const endSpan = (span: TraceSpan, error?: unknown): void => {
  try {
    span.end(error);
  } catch {
  }
};

const traceGenerate = async (
  provider: Provider,
  parent: TraceSpan,
  request: GenerateRequest,
): Promise<GenerateResponse> => {
  const span = startLlmSpan(parent, request, false);

  try {
    const response = await provider.generate(request);
    setOutputAttributes(span, {
      content: response.content,
      toolCalls: response.toolCalls,
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
  const span = startLlmSpan(parent, request, true);

  let content = "";
  const toolCalls: ToolCall[] = [];
  let finishReason: FinishReason = "other";
  let usage: Usage | undefined;
  let ended = false;

  try {
    for await (const event of provider.stream(request)) {
      if (event.type === "text-delta") {
        content += event.delta;
      } else if (event.type === "tool-call") {
        toolCalls.push(event.toolCall);
      } else if (event.type === "finish") {
        finishReason = event.finishReason;
        usage = event.usage;
      }
      yield event;
    }

    ended = true;
    setOutputAttributes(span, { content, toolCalls, finishReason, usage });
    endSpan(span);
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
  generate: (request: GenerateRequest): Promise<GenerateResponse> =>
    traceGenerate(provider, parent, request),
  stream: (request: GenerateRequest): AsyncIterable<StreamEvent> =>
    traceStream(provider, parent, request),
});
