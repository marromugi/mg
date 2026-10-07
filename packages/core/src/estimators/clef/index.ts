import {
  isConnectionCut,
  isRetryableSendFailure,
  retryMarkForStatus,
} from "../../http/retry.js";
import {
  EstimatorRequestError,
  EstimatorResponseError,
} from "../errors.js";
import {
  assertClassifyRequest,
  assertScoreRequest,
} from "../requests.js";
import type {
  Classification,
  ClassifyRequest,
  Estimate,
  EstimateOptions,
  EstimateRequest,
  Estimator,
  EstimatorLimits,
  EstimatorSubject,
  Score,
  ScoreRequest,
} from "../types.js";

export type ClefModel = "clef" | "clef-flash";

export type ClefEstimatorOptions = {
  accountId: string;
  apiToken: string;
  model?: ClefModel;
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

const DEFAULT_MODEL: ClefModel = "clef";
const DEFAULT_BASE_URL = "https://api.cloudflare.com/client/v4";
const MAX_ERROR_BODY_LENGTH = 200;

// 失敗応答の status と本文全体を持ちます。
// message は本文の先頭 200 文字で、長いときは切ったことを添えます。
export class ClefHttpError extends Error {
  override readonly name = "ClefHttpError";
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(
      body.length > MAX_ERROR_BODY_LENGTH
        ? `${body.slice(0, MAX_ERROR_BODY_LENGTH)} (body cut at ${MAX_ERROR_BODY_LENGTH} characters)`
        : body,
    );
    this.status = status;
    this.body = body;
  }
}

const LIMITS: EstimatorLimits = {
  minLabels: 2,
  maxLabels: 255,
  maxLevels: 10,
};

const isAbortError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { name?: unknown }).name === "AbortError";

const isValidProbability = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const failValidation = (reason: string): never => {
  throw new EstimatorResponseError(
    `Clef response failed validation: ${reason}`,
  );
};

// Reads the answer named "answer" out of the Workers AI reply's result.
const readAnswer = (
  json: unknown,
  type: "noul" | "choice" | "score",
): Record<string, unknown> => {
  const result = isRecord(json) ? json.result : undefined;
  const answers = isRecord(result) ? result.answers : undefined;
  const answer = isRecord(answers) ? answers.answer : undefined;
  if (!isRecord(answer) || answer.type !== type) {
    return failValidation(`answer is missing or not of type ${type}`);
  }
  return answer;
};

const readProbabilities = (
  value: unknown,
  keys: readonly string[],
  noun: "labels" | "levels",
): number[] => {
  if (!isRecord(value)) {
    return failValidation("probabilities is not an object");
  }
  const covers =
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
  if (!covers) {
    return failValidation(
      `probabilities do not cover exactly the ${noun}`,
    );
  }
  return keys.map((key) => {
    const probability = value[key];
    if (!isValidProbability(probability)) {
      return failValidation(
        `probability for "${key}" is not between 0 and 1`,
      );
    }
    return probability;
  });
};

const describeErrors = (errors: unknown): string => {
  if (errors === undefined) return "no errors were given";
  try {
    return JSON.stringify(errors);
  } catch {
    return "errors could not be shown";
  }
};

export const createClefEstimator = (
  options: ClefEstimatorOptions,
): Estimator => {
  const model = options.model ?? DEFAULT_MODEL;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  const url = `${baseUrl}/accounts/${options.accountId}/ai/run/@cf/cloudflare/${model}`;

  const buildHeaders = (): Headers => {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${options.apiToken}`);
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
      if (signal?.aborted) throw signal.reason;
      if (isAbortError(error)) throw error;
      throw new EstimatorRequestError("Clef request failed", {
        cause: error,
        retryable: isRetryableSendFailure(error),
      });
    }

    if (!response.ok) {
      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (isAbortError(error)) throw error;
        throw new EstimatorRequestError(
          `Clef request failed: ${response.status}; the body could not be read`,
          { cause: error, ...retryMarkForStatus(response) },
        );
      }
      throw new EstimatorRequestError(
        `Clef request failed: ${response.status}`,
        {
          cause: new ClefHttpError(response.status, text),
          causeQuotesService: text === "" ? undefined : true,
          ...retryMarkForStatus(response),
        },
      );
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (isAbortError(error)) throw error;
      // A cut connection got no answer, so it can be retried.
      if (isConnectionCut(error)) {
        throw new EstimatorRequestError(
          "Clef response body could not be read",
          { cause: error, retryable: true },
        );
      }
      throw new EstimatorResponseError(
        "Clef response body could not be read",
        { cause: error },
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new EstimatorResponseError("Clef response is not JSON", {
        cause: error,
        causeQuotesService: true,
      });
    }

    if (isRecord(json) && json.success === false) {
      throw new EstimatorResponseError(
        `Clef response reports failure: ${describeErrors(json.errors)}`,
        { causeQuotesService: true },
      );
    }

    return json;
  };

  const ask = (
    request: { subject: EstimatorSubject; question: string },
    question: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<unknown> =>
    send(
      JSON.stringify({
        model,
        state: request.subject,
        questions: {
          answer: { ...question, instructions: request.question },
        },
      }),
      signal,
    );

  return {
    model,
    limits: LIMITS,
    async estimate(
      request: EstimateRequest,
      estimateOptions?: EstimateOptions,
    ): Promise<Estimate> {
      estimateOptions?.signal?.throwIfAborted();

      const json = await ask(
        request,
        { type: "noul" },
        estimateOptions?.signal,
      );

      const { noul } = readAnswer(json, "noul");
      if (!isValidProbability(noul)) {
        return failValidation("probability is not between 0 and 1");
      }
      return { probability: noul };
    },
    async classify(
      request: ClassifyRequest,
      classifyOptions?: EstimateOptions,
    ): Promise<Classification> {
      classifyOptions?.signal?.throwIfAborted();
      assertClassifyRequest(request, LIMITS);

      const json = await ask(
        request,
        { type: "choice", criteria: request.labels },
        classifyOptions?.signal,
      );

      const { choice, probabilities } = readAnswer(json, "choice");
      if (typeof choice !== "string") {
        return failValidation("chosen label is not a string");
      }
      if (!Object.hasOwn(request.labels, choice)) {
        return failValidation(
          `chosen label "${choice}" is not among the labels`,
        );
      }

      const labelKeys = Object.keys(request.labels);
      const values = readProbabilities(
        probabilities,
        labelKeys,
        "labels",
      );

      return {
        label: choice,
        probabilities: Object.fromEntries(
          labelKeys.map((key, index) => [key, values[index]]),
        ),
      };
    },
    async score(
      request: ScoreRequest,
      scoreOptions?: EstimateOptions,
    ): Promise<Score> {
      scoreOptions?.signal?.throwIfAborted();
      assertScoreRequest(request, LIMITS);

      const json = await ask(
        request,
        { type: "score", criteria: request.levels },
        scoreOptions?.signal,
      );

      const { score, probabilities } = readAnswer(json, "score");
      if (typeof score !== "number") {
        return failValidation("score is not a number");
      }

      const levelKeys = request.levels.map((_, index) => String(index));
      const values = readProbabilities(
        probabilities,
        levelKeys,
        "levels",
      );

      if (score < 0 || score > request.levels.length - 1) {
        return failValidation(`score ${score} is outside the levels`);
      }

      return { score, probabilities: values };
    },
  };
};
