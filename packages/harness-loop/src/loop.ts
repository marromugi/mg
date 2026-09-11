import { runToolCall } from "@mg/core";
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
import type { Harness, HarnessEvent } from "@mg/harness";

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
    // Provider.stream's contract (packages/core/src/providers/types.ts) guarantees a
    // "finish" event before the iterable ends; openrouter's implementation always emits one.
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
        ? yield* runStreamedTurn(options.provider, request)
        : yield* runBatchTurn(options.provider, request);

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
        return;
      }

      input.signal?.throwIfAborted();

      const results = await Promise.all(
        turnResult.toolCalls.map((call) => runToolCall(options.tools ?? [], call, { signal: input.signal })),
      );
      for (const result of results) {
        messages.push(result);
        yield { type: "tool-result", message: result };
      }
    }

    yield { type: "done", result: { reason: "max-turns", messages, usage } };
  };
};
