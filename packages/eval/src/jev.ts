import { z } from "zod";
import { isAbortError } from "./abort.js";
import { JevCheckError } from "./errors.js";
import { transcribe } from "./transcript.js";
import type {
  Check,
  CheckOutcome,
  EvalContext,
  EvalInput,
} from "./types.js";
import type { RunView } from "./view.js";

export type JevCheckerOptions = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  transcribe?: (view: RunView) => string;
};

export type JevCheckOptions = {
  name: string;
  question: string;
  threshold?: number;
};

export type JevChecker = (options: JevCheckOptions) => Check;

const DEFAULT_MODEL = "jev-latest";
const DEFAULT_BASE_URL = "https://api.typesafe.ai/v1";
const DEFAULT_THRESHOLD = 0.9;
const MAX_ERROR_BODY_LENGTH = 200;

const jevResponse = z.object({
  answers: z.object({
    answer: z.object({
      type: z.literal("noul"),
      probability: z.number().min(0).max(1),
    }),
  }),
});

const isValidThreshold = (threshold: number): boolean =>
  Number.isFinite(threshold) && threshold >= 0 && threshold <= 1;

export const createJevChecker = (
  options: JevCheckerOptions,
): JevChecker => {
  const model = options.model ?? DEFAULT_MODEL;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  const url = `${baseUrl}/systemone`;
  const toText = options.transcribe ?? transcribe;

  const buildHeaders = (): Headers => {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${options.apiKey}`);
    headers.set("Content-Type", "application/json");
    return headers;
  };

  return (checkOptions: JevCheckOptions): Check => {
    const { name, question } = checkOptions;
    const threshold = checkOptions.threshold ?? DEFAULT_THRESHOLD;

    if (name === "") {
      throw new RangeError("check name must not be empty");
    }
    if (question === "") {
      throw new RangeError("question must not be empty");
    }
    if (!isValidThreshold(threshold)) {
      throw new RangeError("threshold must be between 0 and 1");
    }

    return {
      name,
      async evaluate(
        input: EvalInput,
        context?: EvalContext,
      ): Promise<CheckOutcome> {
        context?.signal?.throwIfAborted();

        const doFetch = options.fetch ?? globalThis.fetch;

        const body = JSON.stringify({
          model,
          state: toText(input.view),
          questions: {
            answer: {
              type: "noul",
              instructions: question,
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
          throw new JevCheckError("Jev request failed", {
            cause: error,
          });
        }

        if (!response.ok) {
          let text = "";
          try {
            text = await response.text();
          } catch {
            // ignore: fall back to the status alone
          }
          const snippet = text.slice(0, MAX_ERROR_BODY_LENGTH);
          throw new JevCheckError(
            `Jev request failed: ${response.status}${
              snippet === "" ? "" : ` ${snippet}`
            }`,
          );
        }

        let json: unknown;
        try {
          json = await response.json();
        } catch (error) {
          if (isAbortError(error)) throw error;
          throw new JevCheckError("Jev response is not JSON", {
            cause: error,
          });
        }

        const parsed = jevResponse.safeParse(json);
        if (!parsed.success) {
          throw new JevCheckError("Jev response failed validation", {
            cause: parsed.error,
          });
        }

        const { probability } = parsed.data.answers.answer;
        const passed = probability >= threshold;

        return {
          passed,
          score: probability,
          threshold,
          reason: `Jev answered ${probability.toFixed(
            3,
          )}; threshold ${threshold}`,
        };
      },
    };
  };
};
