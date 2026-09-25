import type {
  AssistantMessage,
  FinishReason,
  GenerateRequest,
  Message,
  Provider,
  Tool,
  ToolCall,
  ToolDefinition,
  ToolMessage,
  Usage,
} from "@mg/core";
import {
  assistantMessage,
  createPartsAccumulator,
  partsOf,
  runToolCall,
  toolCallsOf,
} from "@mg/core";
import type { Gate } from "@mg/gate";
import { gateRunToolCall } from "@mg/gate";
import { noopSpan, runSubagentCall } from "@mg/harness";
import type {
  Harness,
  HarnessEvent,
  RunSubagentCall,
  Subagent,
  TraceSpan,
} from "@mg/harness";
import type { RunToolCall } from "@mg/trace";
import {
  ATTR,
  SPAN,
  traceProvider,
  traceRunSubagentCall,
  traceRunToolCall,
} from "@mg/trace";
import {
  DuplicateCallableNameError,
  StreamIncompleteError,
} from "./errors.js";
import { toolErrorToMessage } from "./tool-error.js";

export type LoopHarnessOptions = {
  provider: Provider;
  model: string;
  tools?: readonly Tool[];
  subagents?: readonly Subagent[];
  maxTurns: number;
  stream?: boolean;
  gate?: Gate;
};

type TurnResult = {
  assistantMessage: AssistantMessage;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage?: Usage;
};

async function* runBatchTurn(
  provider: Provider,
  request: GenerateRequest,
): AsyncGenerator<HarnessEvent, TurnResult> {
  const response = await provider.generate(request);

  for (const part of partsOf(response)) {
    switch (part.type) {
      case "text":
        if (part.text !== "") {
          yield { type: "text-delta", delta: part.text };
        }
        break;
      case "reasoning":
        if (part.text !== "") {
          yield { type: "reasoning-delta", delta: part.text };
        }
        break;
      case "tool-call":
        yield {
          type: "tool-call",
          toolCall: {
            id: part.id,
            name: part.name,
            arguments: part.arguments,
          },
        };
        break;
    }
  }

  const message = assistantMessage(partsOf(response));
  return {
    assistantMessage: message,
    toolCalls: toolCallsOf(message),
    finishReason: response.finishReason,
    usage: response.usage,
  };
}

async function* runStreamedTurn(
  provider: Provider,
  request: GenerateRequest,
): AsyncGenerator<HarnessEvent, TurnResult> {
  const accumulator = createPartsAccumulator();
  let finishReason: FinishReason | undefined;
  let usage: Usage | undefined;

  for await (const event of provider.stream(request)) {
    accumulator.push(event);
    switch (event.type) {
      case "text-delta":
        yield { type: "text-delta", delta: event.delta };
        break;
      case "reasoning-delta":
        if (event.delta !== "") {
          yield { type: "reasoning-delta", delta: event.delta };
        }
        break;
      case "tool-call":
        yield { type: "tool-call", toolCall: event.toolCall };
        break;
      case "finish":
        finishReason = event.finishReason;
        usage = event.usage;
        break;
    }
  }

  if (finishReason === undefined) {
    throw new StreamIncompleteError();
  }

  const message = assistantMessage(accumulator.parts());
  return {
    assistantMessage: message,
    toolCalls: toolCallsOf(message),
    finishReason,
    usage,
  };
}

const notRunMessage = (call: ToolCall): ToolMessage => ({
  role: "tool",
  toolCallId: call.id,
  content:
    "[not-run] The call was not run because the run was wrapped up.",
});

const stoppedMessage = (call: ToolCall): ToolMessage => ({
  role: "tool",
  toolCallId: call.id,
  content:
    "[stopped] The call was stopped before it finished because the run was wrapped up. Whether it took effect is unknown.",
});

const toolSignalFor = (
  signal: AbortSignal | undefined,
  wrapUp: AbortSignal | undefined,
): AbortSignal | undefined => {
  if (!wrapUp) return signal;
  return signal ? AbortSignal.any([signal, wrapUp]) : wrapUp;
};

const waitForAbort = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });

const checkForDuplicateNames = (
  tools: readonly ToolDefinition[],
  subagents: readonly Subagent[],
): void => {
  const subagentNames = new Set<string>();
  for (const subagent of subagents) {
    if (subagentNames.has(subagent.name)) {
      throw new DuplicateCallableNameError(subagent.name);
    }
    subagentNames.add(subagent.name);
  }
  for (const tool of tools) {
    if (subagentNames.has(tool.name)) {
      throw new DuplicateCallableNameError(tool.name);
    }
  }
};

export const createLoopHarness = (
  options: LoopHarnessOptions,
): Harness => {
  if (!(options.maxTurns >= 1)) {
    throw new RangeError(
      `maxTurns must be >= 1, got ${options.maxTurns}`,
    );
  }

  const tools = options.tools ?? [];
  const subagents = options.subagents ?? [];
  checkForDuplicateNames(tools, subagents);

  const toolDefinitions =
    options.tools || options.subagents
      ? [
          ...tools,
          ...subagents.map((subagent): ToolDefinition => ({
            name: subagent.name,
            description: subagent.description,
            input: subagent.input,
          })),
        ]
      : undefined;
  const stream = options.stream ?? true;
  const subagentNames = new Set(
    subagents.map((subagent) => subagent.name),
  );

  return async function* (input) {
    let span: TraceSpan;
    let provider: Provider;
    let run: RunToolCall;
    let runSubagent: RunSubagentCall;

    if (input.trace === undefined) {
      span = noopSpan;
      provider = options.provider;
      run =
        options.gate === undefined
          ? runToolCall
          : gateRunToolCall(options.gate, runToolCall);
      runSubagent =
        options.gate === undefined
          ? runSubagentCall
          : gateRunToolCall(options.gate, runSubagentCall);
    } else {
      try {
        span = input.trace.startSpan(SPAN.harness, {
          [ATTR.op]: "harness",
          [ATTR.harnessName]: "loop",
        });
      } catch {
        span = noopSpan;
      }
      provider = traceProvider(options.provider, span);
      run =
        options.gate === undefined
          ? traceRunToolCall(span)
          : gateRunToolCall(options.gate, traceRunToolCall(span), span);
      runSubagent =
        options.gate === undefined
          ? traceRunSubagentCall(span)
          : gateRunToolCall(
              options.gate,
              traceRunSubagentCall(span),
              span,
            );
    }

    let ended = false;
    const endSpan = (error?: unknown): void => {
      if (ended) return;
      ended = true;
      try {
        span.end(error);
      } catch {}
    };

    const wrapUp = input.wrapUp;

    const runOneCall = (call: ToolCall): Promise<ToolMessage> => {
      const isSubagent = subagentNames.has(call.name);
      const callResult = isSubagent
        ? runSubagent(subagents, call, {
            signal: input.signal,
            wrapUp,
          })
        : run(tools, call, {
            signal: toolSignalFor(input.signal, wrapUp),
          });
      return callResult.catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError")
          throw error;
        return toolErrorToMessage(call, error);
      });
    };

    const runToolCallsRacingWrapUp = async (
      calls: readonly ToolCall[],
      signal: AbortSignal,
    ): Promise<ToolMessage[]> => {
      const results: (ToolMessage | undefined)[] = Array.from({
        length: calls.length,
      });
      const wrapUpSignaled = waitForAbort(signal);

      await Promise.all(
        calls.map((call, index) => {
          const isSubagent = subagentNames.has(call.name);
          const settled = runOneCall(call);

          if (isSubagent) {
            return settled.then((result) => {
              results[index] = result;
            });
          }

          return Promise.race([
            settled.then((result) => {
              results[index] = result;
            }),
            wrapUpSignaled.then(() => {
              if (results[index] === undefined) {
                results[index] = stoppedMessage(call);
              }
            }),
          ]).then(() => {
            settled.catch(() => {});
          });
        }),
      );

      return results as ToolMessage[];
    };

    try {
      const messages: Message[] = [...input.messages];
      let usage: Usage = { inputTokens: 0, outputTokens: 0 };

      for (let turn = 1; turn <= options.maxTurns; turn++) {
        input.signal?.throwIfAborted();

        if (wrapUp?.aborted) {
          endSpan();
          yield {
            type: "done",
            result: { reason: "wrapped-up", messages, usage },
          };
          return;
        }

        const request: GenerateRequest = {
          model: options.model,
          messages,
          tools: toolDefinitions,
          ...(wrapUp ? { halt: wrapUp } : {}),
        };
        const turnResult = stream
          ? yield* runStreamedTurn(provider, request)
          : yield* runBatchTurn(provider, request);

        if (turnResult.usage) {
          usage = {
            inputTokens:
              usage.inputTokens + turnResult.usage.inputTokens,
            outputTokens:
              usage.outputTokens + turnResult.usage.outputTokens,
          };
        }

        messages.push(turnResult.assistantMessage);
        yield {
          type: "turn",
          finishReason: turnResult.finishReason,
          usage: turnResult.usage,
        };

        if (turnResult.finishReason === "halted") {
          for (const call of turnResult.toolCalls) {
            const result = notRunMessage(call);
            messages.push(result);
            yield { type: "tool-result", message: result };
          }
          endSpan();
          yield {
            type: "done",
            result: { reason: "wrapped-up", messages, usage },
          };
          return;
        }

        if (turnResult.toolCalls.length === 0) {
          endSpan();
          yield {
            type: "done",
            result: {
              reason:
                turnResult.finishReason === "length"
                  ? "length"
                  : "stop",
              messages,
              usage,
            },
          };
          return;
        }

        input.signal?.throwIfAborted();

        if (wrapUp?.aborted) {
          for (const call of turnResult.toolCalls) {
            const result = notRunMessage(call);
            messages.push(result);
            yield { type: "tool-result", message: result };
          }
          endSpan();
          yield {
            type: "done",
            result: { reason: "wrapped-up", messages, usage },
          };
          return;
        }

        const results = wrapUp
          ? await runToolCallsRacingWrapUp(turnResult.toolCalls, wrapUp)
          : await Promise.all(turnResult.toolCalls.map(runOneCall));

        for (const result of results) {
          messages.push(result);
          yield { type: "tool-result", message: result };
        }

        if (wrapUp?.aborted) {
          endSpan();
          yield {
            type: "done",
            result: { reason: "wrapped-up", messages, usage },
          };
          return;
        }
      }

      endSpan();
      yield {
        type: "done",
        result: { reason: "max-turns", messages, usage },
      };
    } catch (error) {
      endSpan(error);
      throw error;
    } finally {
      endSpan();
    }
  };
};
