import type {
  GenerateRequest,
  GenerateResponse,
  ToolDefinition,
  ToolForcingProvider,
} from "@mg/core";
import { isProviderError, toolCallsOf } from "@mg/core";
import { noopSpan } from "@mg/harness";
import { ATTR, traceProvider } from "@mg/trace";
import { z } from "zod";
import { isAbortError } from "../abort.js";
import { GateError } from "../errors.js";
import { toStateText } from "../state.js";
import { withGateSpan } from "../trace.js";
import type {
  Gate,
  GateContext,
  GateRequest,
  Verdict,
} from "../types.js";

export type LlmGateOptions = {
  provider: ToolForcingProvider;
  model: string;
  instruction: string;
};

const verdictInput = z.object({
  allowed: z.boolean(),
  reason: z.string(),
});

const verdictTool: ToolDefinition = {
  name: "verdict",
  input: verdictInput,
};

export const createLlmGate = (options: LlmGateOptions): Gate => {
  const { provider, model, instruction } = options;

  if (instruction.trim() === "") {
    throw new RangeError("instruction must not be empty");
  }

  return {
    async judge(
      request: GateRequest,
      context?: GateContext,
    ): Promise<Verdict> {
      context?.signal?.throwIfAborted();

      return withGateSpan(
        context,
        request,
        { [ATTR.gateModel]: model },
        async (span) => {
          const tracedProvider =
            span === noopSpan
              ? provider
              : traceProvider(provider, span);

          const generateRequest: GenerateRequest = {
            model,
            messages: [
              {
                role: "system",
                content: instruction,
              },
              { role: "user", content: toStateText(request) },
            ],
            tools: [verdictTool],
            toolChoice: { type: "tool", name: "verdict" },
          };

          let response: GenerateResponse;
          try {
            response = await tracedProvider.generate(generateRequest);
          } catch (error) {
            if (isAbortError(error)) throw error;
            if (isProviderError(error)) {
              throw new GateError(
                `Gate judgement failed: ${error.message}`,
                {
                  cause: error,
                  callerMessage: `Gate judgement failed: ${error.messageWithoutServiceText}`,
                },
              );
            }
            throw new GateError("Gate judgement failed", {
              cause: error,
            });
          }

          const call = toolCallsOf(response).find(
            (toolCall) => toolCall.name === "verdict",
          );
          if (call === undefined) {
            throw new GateError(
              "Provider did not call the verdict tool",
            );
          }

          const parsed = verdictInput.safeParse(call.arguments);
          if (!parsed.success) {
            throw new GateError("Verdict arguments failed validation", {
              cause: parsed.error,
            });
          }

          return parsed.data;
        },
      );
    },
  };
};
