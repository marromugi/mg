import { describe, expect, test, vi } from "vitest";
import {
  EstimatorRequestError,
  EstimatorResponseError,
} from "../errors.js";
import { createClefEstimator, ClefHttpError } from "./index.js";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const reply = (answer: unknown): unknown => ({
  result: { model: "clef", answers: { answer }, usage: {} },
  success: true,
  errors: [],
});

const stubFetch = (response: () => Response) =>
  vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    response(),
  );

const create = (fetchStub: ReturnType<typeof stubFetch>) =>
  createClefEstimator({
    accountId: "acct",
    apiToken: "token",
    fetch: fetchStub,
  });

const bodyOf = (fetchStub: ReturnType<typeof stubFetch>): unknown =>
  JSON.parse(String(fetchStub.mock.calls[0][1]?.body));

describe("createClefEstimator", () => {
  test("declares 2 as the smallest number of labels, 255 labels and 10 levels", () => {
    const estimator = createClefEstimator({
      accountId: "acct",
      apiToken: "token",
    });

    expect(estimator.model).toBe("clef");
    expect(estimator.limits).toEqual({
      minLabels: 2,
      maxLabels: 255,
      maxLevels: 10,
    });
  });

  test("posts to the Workers AI run address for the model with the bearer token", async () => {
    const fetchStub = stubFetch(() =>
      jsonResponse(reply({ type: "noul", noul: 0.25 })),
    );
    const estimator = createClefEstimator({
      accountId: "acct",
      apiToken: "token",
      model: "clef-flash",
      headers: { "X-Test": "1" },
      fetch: fetchStub,
    });

    await estimator.estimate({ subject: "T", question: "Q" });

    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/cloudflare/clef-flash",
    );
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer token");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Test")).toBe("1");
    expect(bodyOf(fetchStub)).toEqual({
      model: "clef-flash",
      state: "T",
      questions: { answer: { type: "noul", instructions: "Q" } },
    });
  });

  test("sends the labels as criteria and returns the chosen label with its probabilities", async () => {
    const fetchStub = stubFetch(() =>
      jsonResponse(
        reply({
          type: "choice",
          choice: "a",
          confidence: 0.9,
          probabilities: { a: 0.8, b: 0.2 },
        }),
      ),
    );

    const result = await create(fetchStub).classify({
      subject: { k: 1 },
      question: "Q",
      labels: { a: "x", b: "y" },
    });

    expect(result).toEqual({
      label: "a",
      probabilities: { a: 0.8, b: 0.2 },
    });
    expect(bodyOf(fetchStub)).toEqual({
      model: "clef",
      state: { k: 1 },
      questions: {
        answer: {
          type: "choice",
          instructions: "Q",
          criteria: { a: "x", b: "y" },
        },
      },
    });
  });

  test("sends the levels as criteria and returns the score with index-keyed probabilities as an array", async () => {
    const fetchStub = stubFetch(() =>
      jsonResponse(
        reply({
          type: "score",
          score: 1.5,
          legend: "x",
          confidence: 0.9,
          probabilities: { "0": 0.1, "1": 0.5, "2": 0.4 },
        }),
      ),
    );

    const result = await create(fetchStub).score({
      subject: "T",
      question: "Q",
      levels: ["a", "b", "c"],
    });

    expect(result).toEqual({
      score: 1.5,
      probabilities: [0.1, 0.5, 0.4],
    });
    expect(bodyOf(fetchStub)).toEqual({
      model: "clef",
      state: "T",
      questions: {
        answer: {
          type: "score",
          instructions: "Q",
          criteria: ["a", "b", "c"],
        },
      },
    });
  });

  test("refuses a classification with one label before sending anything, naming the minimum", async () => {
    const fetchStub = stubFetch(() => jsonResponse(reply({})));

    const error = await create(fetchStub)
      .classify({ subject: "T", question: "Q", labels: { a: "x" } })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(RangeError);
    expect((error as RangeError).message).toBe(
      "labels has 1 entries; the estimator accepts at least 2",
    );
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test("throws EstimatorRequestError with a ClefHttpError cause and the retry mark on a 429", async () => {
    const fetchStub = stubFetch(
      () =>
        new Response("slow down", {
          status: 429,
          headers: { "Retry-After": "3" },
        }),
    );

    const error = await create(fetchStub)
      .estimate({ subject: "T", question: "Q" })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorRequestError);
    const request = error as EstimatorRequestError;
    expect(request.message).toBe("Clef request failed: 429: slow down");
    expect(request.retryable).toBe(true);
    expect(request.retryAfterMs).toBe(3000);
    expect(request.cause).toBeInstanceOf(ClefHttpError);
    expect((request.cause as ClefHttpError).status).toBe(429);
    expect((request.cause as ClefHttpError).body).toBe("slow down");
  });

  test("throws EstimatorRequestError when sending fails", async () => {
    const estimator = createClefEstimator({
      accountId: "acct",
      apiToken: "token",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });

    const error = await estimator
      .estimate({ subject: "T", question: "Q" })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorRequestError);
    expect((error as EstimatorRequestError).message).toMatch(
      /^Clef request failed/,
    );
  });

  test("throws EstimatorResponseError when the body is not JSON", async () => {
    const fetchStub = stubFetch(() => new Response("<html>"));

    const error = await create(fetchStub)
      .estimate({ subject: "T", question: "Q" })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toMatch(
      /^Clef response is not JSON/,
    );
  });

  test("throws EstimatorResponseError quoting errors when a 2xx reply says success is false", async () => {
    const fetchStub = stubFetch(() =>
      jsonResponse({
        success: false,
        errors: [{ code: 5006, message: "bad input" }],
        result: null,
      }),
    );

    const error = await create(fetchStub)
      .estimate({ subject: "T", question: "Q" })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      'Clef response reports failure: [{"code":5006,"message":"bad input"}]',
    );
  });

  test("throws EstimatorResponseError when the answer is not under result", async () => {
    const fetchStub = stubFetch(() =>
      jsonResponse({
        answers: { answer: { type: "noul", noul: 0.5 } },
      }),
    );

    const error = await create(fetchStub)
      .estimate({ subject: "T", question: "Q" })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      "Clef response failed validation: answer is missing or not of type noul",
    );
  });

  test.each([
    [
      "the chosen label is not among the labels",
      { choice: "z", probabilities: { a: 0.5, b: 0.5 } },
      'chosen label "z" is not among the labels',
    ],
    [
      "the probabilities miss a label",
      { choice: "a", probabilities: { a: 1 } },
      "probabilities do not cover exactly the labels",
    ],
    [
      "a probability is above 1",
      { choice: "a", probabilities: { a: 1.5, b: 0 } },
      'probability for "a" is not between 0 and 1',
    ],
  ])(
    "throws EstimatorResponseError when %s",
    async (_name, answer, message) => {
      const fetchStub = stubFetch(() =>
        jsonResponse(reply({ type: "choice", ...answer })),
      );

      const error = await create(fetchStub)
        .classify({
          subject: "T",
          question: "Q",
          labels: { a: "x", b: "y" },
        })
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(EstimatorResponseError);
      expect((error as EstimatorResponseError).message).toBe(
        `Clef response failed validation: ${message}`,
      );
    },
  );

  test.each([
    [
      "the score is outside the levels",
      { score: 3, probabilities: { "0": 0.5, "1": 0.5 } },
      "score 3 is outside the levels",
    ],
    [
      "the probabilities are keyed by something other than the index",
      { score: 0, probabilities: { a: 0.5, b: 0.5 } },
      "probabilities do not cover exactly the levels",
    ],
  ])(
    "throws EstimatorResponseError when %s",
    async (_name, answer, message) => {
      const fetchStub = stubFetch(() =>
        jsonResponse(reply({ type: "score", ...answer })),
      );

      const error = await create(fetchStub)
        .score({ subject: "T", question: "Q", levels: ["a", "b"] })
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(EstimatorResponseError);
      expect((error as EstimatorResponseError).message).toBe(
        `Clef response failed validation: ${message}`,
      );
    },
  );
});
