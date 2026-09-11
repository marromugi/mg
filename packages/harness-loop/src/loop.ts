import { runToolCall } from "@mg/core";
import type { AssistantMessage, Message, Provider, Tool, Usage } from "@mg/core";
import type { Harness } from "@mg/harness";

export type LoopHarnessOptions = {
  provider: Provider;
  model: string;
  tools?: readonly Tool[];
  maxTurns: number;
};

export const createLoopHarness = (options: LoopHarnessOptions): Harness => {
  if (options.maxTurns < 1) {
    throw new RangeError(`maxTurns must be >= 1, got ${options.maxTurns}`);
  }

  const toolDefinitions = options.tools ? [...options.tools] : undefined;

  return async function* (input) {
    const messages: Message[] = [...input.messages];
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };

    for (let turn = 1; turn <= options.maxTurns; turn++) {
      input.signal?.throwIfAborted();

      const response = await options.provider.generate({
        model: options.model,
        messages,
        tools: toolDefinitions,
      });

      if (response.usage) {
        usage = {
          inputTokens: usage.inputTokens + response.usage.inputTokens,
          outputTokens: usage.outputTokens + response.usage.outputTokens,
        };
      }

      const assistantMessage: AssistantMessage = {
        role: "assistant",
        content: response.content,
        ...(response.toolCalls.length > 0 ? { toolCalls: response.toolCalls } : {}),
      };
      messages.push(assistantMessage);

      if (response.content !== "") {
        yield { type: "text-delta", delta: response.content };
      }
      for (const toolCall of response.toolCalls) {
        yield { type: "tool-call", toolCall };
      }
      yield { type: "turn", finishReason: response.finishReason, usage: response.usage };

      if (response.toolCalls.length === 0) {
        yield {
          type: "done",
          result: {
            reason: response.finishReason === "length" ? "length" : "stop",
            messages,
            usage,
          },
        };
        return;
      }

      const results = await Promise.all(
        response.toolCalls.map((call) => runToolCall(options.tools ?? [], call, { signal: input.signal })),
      );
      for (const result of results) {
        messages.push(result);
        yield { type: "tool-result", message: result };
      }
    }

    yield { type: "done", result: { reason: "max-turns", messages, usage } };
  };
};
