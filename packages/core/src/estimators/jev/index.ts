import {
  EstimatorHttpError,
  EstimatorResponseError,
  EstimatorTransportError,
} from "../errors.js";
import type {
  Estimate,
  EstimateOptions,
  EstimateRequest,
  Estimator,
} from "../types.js";

export type JevEstimatorOptions = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

const DEFAULT_MODEL = "jev-latest";
const DEFAULT_BASE_URL = "https://api.typesafe.ai/v1";
const MAX_ERROR_BODY_LENGTH = 200;

const isAbortError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { name?: unknown }).name === "AbortError";

const isValidProbability = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

type JevResponse = {
  answers: { answer: { type: "noul"; noul: number } };
};

const isJevResponse = (json: unknown): json is JevResponse => {
  if (typeof json !== "object" || json === null) return false;
  const { answers } = json as { answers?: unknown };
  if (typeof answers !== "object" || answers === null) return false;
  const { answer } = answers as { answer?: unknown };
  if (typeof answer !== "object" || answer === null) return false;
  const { type, noul } = answer as {
    type?: unknown;
    noul?: unknown;
  };
  return type === "noul" && isValidProbability(noul);
};

export const createJevEstimator = (
  options: JevEstimatorOptions,
): Estimator => {
  const model = options.model ?? DEFAULT_MODEL;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  const url = `${baseUrl}/systemone`;

  const buildHeaders = (): Headers => {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${options.apiKey}`);
    headers.set("Content-Type", "application/json");
    return headers;
  };

  return {
    model,
    async estimate(
      request: EstimateRequest,
      estimateOptions?: EstimateOptions,
    ): Promise<Estimate> {
      estimateOptions?.signal?.throwIfAborted();

      const doFetch = options.fetch ?? globalThis.fetch;

      const body = JSON.stringify({
        model,
        state: request.text,
        questions: {
          answer: {
            type: "noul",
            instructions: request.question,
          },
        },
      });

      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers: buildHeaders(),
          body,
          signal: estimateOptions?.signal,
        });
      } catch (error) {
        if (isAbortError(error)) throw error;
        throw new EstimatorTransportError("Jev request failed", {
          cause: error,
        });
      }

      if (!response.ok) {
        let text = "";
        try {
          text = await response.text();
        } catch (error) {
          if (isAbortError(error)) throw error;
          // ignore: fall back to the status alone
        }
        const snippet = text.slice(0, MAX_ERROR_BODY_LENGTH);
        throw new EstimatorHttpError(
          `Jev request failed: ${response.status}${
            snippet === "" ? "" : ` ${snippet}`
          }`,
          response.status,
          text,
        );
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch (error) {
        if (isAbortError(error)) throw error;
        throw new EstimatorResponseError("Jev response is not JSON", {
          cause: error,
        });
      }

      if (!isJevResponse(json)) {
        throw new EstimatorResponseError(
          "Jev response failed validation",
        );
      }

      return { probability: json.answers.answer.noul };
    },
  };
};
