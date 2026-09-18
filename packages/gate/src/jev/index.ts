import { ATTR } from "@mg/trace";
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

export type JevGateOptions = {
  apiKey: string;
  policy: string;
  model?: string;
  baseUrl?: string;
  threshold?: number;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

const DEFAULT_MODEL = "jev-latest";
const DEFAULT_BASE_URL = "https://api.typesafe.ai/v1";
const DEFAULT_THRESHOLD = 0.5;

const QUESTION = "Is it fine to run this action?";

const jevResponse = z.object({
  answers: z.object({
    allowed: z.object({
      type: z.literal("noul"),
      probability: z.number(),
    }),
  }),
});

export const createJevGate = (options: JevGateOptions): Gate => {
  const model = options.model ?? DEFAULT_MODEL;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  const url = `${baseUrl}/systemone`;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  const buildHeaders = (): Headers => {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${options.apiKey}`);
    headers.set("Content-Type", "application/json");
    return headers;
  };

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
        async () => {
          const doFetch = options.fetch ?? globalThis.fetch;

          const body = JSON.stringify({
            model,
            state: toStateText(request),
            questions: {
              allowed: {
                type: "noul",
                instructions: `${options.policy}\n\n${QUESTION}`,
              },
            },
          });

          let response: Response;
          try {
            response = await doFetch(url, {
              method: "POST",
              headers: buildHeaders(),
              body,
              signal: context?.signal,
            });
          } catch (error) {
            if (isAbortError(error)) throw error;
            throw new GateError("Gate judgement failed", {
              cause: error,
            });
          }

          if (!response.ok) {
            throw new GateError(
              `Jev request failed: ${response.status}`,
            );
          }

          let json: unknown;
          try {
            json = await response.json();
          } catch (error) {
            throw new GateError("Jev response is not JSON", {
              cause: error,
            });
          }

          const parsed = jevResponse.safeParse(json);
          if (!parsed.success) {
            throw new GateError("Jev response failed validation", {
              cause: parsed.error,
            });
          }

          const { probability } = parsed.data.answers.allowed;
          const allowed = probability >= threshold;
          const reason =
            `Jev answered ${probability.toFixed(2)} for "may run" ` +
            `(threshold ${threshold.toFixed(2)}).`;

          return { allowed, reason };
        },
      );
    },
  };
};
