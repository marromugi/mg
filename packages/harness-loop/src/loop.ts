import type {
  AssistantMessage,
  FinishReason,
  GenerateRequest,
  Message,
  Provider,
  Tool,
  ToolCall,
  Usage,
} from "@mg/core";
import { noopSpan } from "@mg/harness";
import type { Harness, HarnessEvent, TraceSpan } from "@mg/harness";
import { ATTR, SPAN, traceProvider, traceRunToolCall } from "@mg/trace";
import { toolErrorToMessage } from "./tool-error.js";

export type LoopHarnessOptions = {
  provider: Provider;
  model: string;
  tools?: readonly Tool[];
  maxTurns: number;
  stream?: boolean;
};

type TurnResult = {
  assistantMessage: AssistantMessage;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage?: Usage;
};

const toAssistantMessage = (content: string, toolCalls: ToolCall[]): AssistantMessage => ({
  role: "assistant",
  content,
  ...(toolCalls.length > 0 ? { toolCalls } : {}),
});

async function* runBatchTurn(
  provider: Provider,
  request: GenerateRequest,
): AsyncGenerator<HarnessEvent, TurnResult> {
  const response = await provider.generate(request);

  if (response.content !== "") {
    yield { type: "text-delta", delta: response.content };
  }
  for (const toolCall of response.toolCalls) {
    yield { type: "tool-call", toolCall };
  }

  return {
    assistantMessage: toAssistantMessage(response.content, response.toolCalls),
    toolCalls: response.toolCalls,
    finishReason: response.finishReason,
    usage: response.usage,
  };
}

async function* runStreamedTurn(
  provider: Provider,
  request: GenerateRequest,
): AsyncGenerator<HarnessEvent, TurnResult> {
  let content = "";
  const toolCalls: ToolCall[] = [];
  let finishReason: FinishReason | undefined;
  let usage: Usage | undefined;

  for await (const event of provider.stream(request)) {
    switch (event.type) {
      case "text-delta":
        content += event.delta;
        yield { type: "text-delta", delta: event.delta };
        break;
      case "tool-call":
        toolCalls.push(event.toolCall);
        yield { type: "tool-call", toolCall: event.toolCall };
        break;
      case "finish":
        finishReason = event.finishReason;
        usage = event.usage;
        break;
    }
  }

  if (finishReason === undefined) {
    throw new Error("provider.stream ended without a finish event");
  }

  return {
    assistantMessage: toAssistantMessage(content, toolCalls),
    toolCalls,
    finishReason,
    usage,
  };
}

export const createLoopHarness = (options: LoopHarnessOptions): Harness => {
  if (!(options.maxTurns >= 1)) {
    throw new RangeError(`maxTurns must be >= 1, got ${options.maxTurns}`);
  }

  const toolDefinitions = options.tools ? [...options.tools] : undefined;
  const stream = options.stream ?? true;

  return async function* (input) {
    const root = input.trace ?? noopSpan;
    let span: TraceSpan;
    try {
      span = root.startSpan(SPAN.harness, { [ATTR.op]: "harness", [ATTR.harnessName]: "loop" });
    } catch {
      span = noopSpan;
    }

    const provider = traceProvider(options.provider, span);
    const run = traceRunToolCall(span);

    let ended = false;
    const endSpan = (error?: unknown): void => {
      if (ended) return;
      ended = true;
      try {
        span.end(error);
      } catch {
      }
    };

    try {
      const messages: Message[] = [...input.messages];
      let usage: Usage = { inputTokens: 0, outputTokens: 0 };

      for (let turn = 1; turn <= options.maxTurns; turn++) {
        input.signal?.throwIfAborted();

        const request: GenerateRequest = {
          model: options.model,
          messages,
          tools: toolDefinitions,
        };
        const turnResult = stream
          ? yield* runStreamedTurn(provider, request)
          : yield* runBatchTurn(provider, request);

        if (turnResult.usage) {
          usage = {
            inputTokens: usage.inputTokens + turnResult.usage.inputTokens,
            outputTokens: usage.outputTokens + turnResult.usage.outputTokens,
          };
        }

        messages.push(turnResult.assistantMessage);
        yield { type: "turn", finishReason: turnResult.finishReason, usage: turnResult.usage };

        if (turnResult.toolCalls.length === 0) {
          yield {
            type: "done",
            result: {
              reason: turnResult.finishReason === "length" ? "length" : "stop",
              messages,
              usage,
            },
          };
          endSpan();
          return;
        }

        input.signal?.throwIfAborted();

        const results = await Promise.all(
          turnResult.toolCalls.map((call) =>
            run(options.tools ?? [], call, { signal: input.signal }).catch((error: unknown) => {
              if (error instanceof Error && error.name === "AbortError") throw error;
              return toolErrorToMessage(call, error);
            }),
          ),
        );
        for (const result of results) {
          messages.push(result);
          yield { type: "tool-result", message: result };
        }
      }

      yield { type: "done", result: { reason: "max-turns", messages, usage } };
      endSpan();
    } catch (error) {
      endSpan(error);
      throw error;
    } finally {
      endSpan();
    }
  };
};
