import {
  EstimatorHttpError,
  EstimatorResponseError,
  EstimatorTransportError,
} from "../errors.js";
import { assertClassifyRequest } from "../requests.js";
import type {
  Classification,
  ClassifyRequest,
  Estimate,
  EstimateOptions,
  EstimateRequest,
  Estimator,
  EstimatorLimits,
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

const LIMITS: EstimatorLimits = { maxLabels: 255, maxLevels: 10 };

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

type JevChoiceResponse = {
  answers: {
    answer: {
      type: "choice";
      choice: string;
      probabilities: Record<string, unknown>;
    };
  };
};

const isJevChoiceResponse = (
  json: unknown,
): json is JevChoiceResponse => {
  if (typeof json !== "object" || json === null) return false;
  const { answers } = json as { answers?: unknown };
  if (typeof answers !== "object" || answers === null) return false;
  const { answer } = answers as { answer?: unknown };
  if (typeof answer !== "object" || answer === null) return false;
  const { type, choice, probabilities } = answer as {
    type?: unknown;
    choice?: unknown;
    probabilities?: unknown;
  };
  return (
    type === "choice" &&
    typeof choice === "string" &&
    typeof probabilities === "object" &&
    probabilities !== null
  );
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

  const send = async (
    body: string,
    signal: AbortSignal | undefined,
  ): Promise<unknown> => {
    const doFetch = options.fetch ?? globalThis.fetch;

    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: buildHeaders(),
        body,
        signal,
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

    try {
      return await response.json();
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new EstimatorResponseError("Jev response is not JSON", {
        cause: error,
      });
    }
  };

  return {
    model,
    limits: LIMITS,
    async estimate(
      request: EstimateRequest,
      estimateOptions?: EstimateOptions,
    ): Promise<Estimate> {
      estimateOptions?.signal?.throwIfAborted();

      const body = JSON.stringify({
        model,
        state: request.subject,
        questions: {
          answer: {
            type: "noul",
            instructions: request.question,
          },
        },
      });

      const json = await send(body, estimateOptions?.signal);

      if (!isJevResponse(json)) {
        throw new EstimatorResponseError(
          "Jev response failed validation",
        );
      }

      return { probability: json.answers.answer.noul };
    },
    async classify(
      request: ClassifyRequest,
      classifyOptions?: EstimateOptions,
    ): Promise<Classification> {
      classifyOptions?.signal?.throwIfAborted();
      assertClassifyRequest(request, LIMITS);

      const body = JSON.stringify({
        model,
        state: request.subject,
        questions: {
          answer: {
            type: "choice",
            instructions: request.question,
            criteria: request.labels,
          },
        },
      });

      const json = await send(body, classifyOptions?.signal);

      if (!isJevChoiceResponse(json)) {
        throw new EstimatorResponseError(
          "Jev response failed validation: answer is missing or not of type choice",
        );
      }

      const { choice, probabilities } = json.answers.answer;

      if (!Object.hasOwn(request.labels, choice)) {
        throw new EstimatorResponseError(
          `Jev response failed validation: chosen label "${choice}" is not among the labels`,
        );
      }

      const labelKeys = Object.keys(request.labels);
      const probabilityKeys = Object.keys(probabilities);
      const coversExactlyTheLabels =
        labelKeys.length === probabilityKeys.length &&
        labelKeys.every((key) => Object.hasOwn(probabilities, key));

      if (!coversExactlyTheLabels) {
        throw new EstimatorResponseError(
          "Jev response failed validation: probabilities do not cover exactly the labels",
        );
      }

      const result: Record<string, number> = {};
      for (const key of labelKeys) {
        const value = probabilities[key];
        if (!isValidProbability(value)) {
          throw new EstimatorResponseError(
            `Jev response failed validation: probability for "${key}" is not between 0 and 1`,
          );
        }
        result[key] = value;
      }

      return { label: choice, probabilities: result };
    },
  };
};
