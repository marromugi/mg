import type {
  GenerateRequest,
  GenerateResponse,
  Provider,
  ToolDefinition,
} from "@mg/core";
import { z } from "zod";
import { GateError } from "../errors.js";
import type {
  Gate,
  GateContext,
  GateRequest,
  Verdict,
} from "../types.js";

export type LlmGateOptions = {
  provider: Provider;
  model: string;
  policy: string;
};

const SYSTEM_INSTRUCTION =
  "You decide whether an action may run without asking a human, " +
  "based only on the policy below. Call the verdict tool with " +
  "your decision.";

const verdictInput = z.object({
  allowed: z.boolean(),
  reason: z.string(),
});

const verdictTool: ToolDefinition = {
  name: "verdict",
  input: verdictInput,
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

const toUserMessage = (request: GateRequest): string =>
  `Kind: ${request.kind}\n${request.description}`;

export const createLlmGate = (options: LlmGateOptions): Gate => {
  const { provider, model, policy } = options;

  return {
    async judge(
      request: GateRequest,
      context?: GateContext,
    ): Promise<Verdict> {
      context?.signal?.throwIfAborted();

      const generateRequest: GenerateRequest = {
        model,
        messages: [
          {
            role: "system",
            content: `${SYSTEM_INSTRUCTION}\n\n${policy}`,
          },
          { role: "user", content: toUserMessage(request) },
        ],
        tools: [verdictTool],
        toolChoice: { type: "tool", name: "verdict" },
      };

      let response: GenerateResponse;
      try {
        response = await provider.generate(generateRequest);
      } catch (error) {
        if (isAbortError(error)) throw error;
        throw new GateError("Gate judgement failed", { cause: error });
      }

      const call = response.toolCalls.find(
        (toolCall) => toolCall.name === "verdict",
      );
      if (call === undefined) {
        throw new GateError("Provider did not call the verdict tool");
      }

      const parsed = verdictInput.safeParse(call.arguments);
      if (!parsed.success) {
        throw new GateError("Verdict arguments failed validation", {
          cause: parsed.error,
        });
      }

      return parsed.data;
    },
  };
};
