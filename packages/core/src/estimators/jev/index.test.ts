import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  EstimatorRequestError,
  EstimatorResponseError,
  isEstimatorError,
} from "../errors.js";
import type {
  ClassifyRequest,
  EstimateRequest,
  ScoreRequest,
} from "../types.js";
import { createRetryingEstimator } from "../retry.js";
import { createJevEstimator, JevHttpError } from "./index.js";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const stubFetch = (
  impl: (
    url: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
) => vi.fn(impl);

const answer = (noul: unknown): unknown => ({
  answers: { answer: { type: "noul", noul } },
});

const request: EstimateRequest = { subject: "T", question: "Q" };

const choiceAnswer = (
  choice: unknown,
  probabilities: unknown,
  extra: Record<string, unknown> = {},
): unknown => ({
  answers: {
    answer: {
      type: "choice",
      choice,
      confidence: 1,
      probabilities,
      ...extra,
    },
  },
});

const classifyRequest: ClassifyRequest = {
  subject: "T",
  question: "Q",
  labels: { a: "x", b: "y" },
};

const scoreAnswer = (
  score: unknown,
  probabilities: unknown,
  extra: Record<string, unknown> = {},
): unknown => ({
  answers: {
    answer: {
      type: "score",
      score,
      confidence: 1,
      probabilities,
      ...extra,
    },
  },
});

const scoreRequest: ScoreRequest = {
  subject: "T",
  question: "Q",
  levels: ["a", "b", "c"],
};

describe("createJevEstimator", () => {
  test("sends to the systemone URL with the bearer header and JSON content type", async () => {
    const fetchStub = stubFetch(async () => jsonResponse(answer(0.9)));
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await estimator.estimate(request);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer key");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  test("trims a trailing slash from a custom baseUrl", async () => {
    const fetchStub = stubFetch(async () => jsonResponse(answer(0.9)));
    const estimator = createJevEstimator({
      apiKey: "key",
      baseUrl: "https://example.test/v1/",
      fetch: fetchStub,
    });

    await estimator.estimate(request);

    const [url] = fetchStub.mock.calls[0];
    expect(url).toBe("https://example.test/v1/systemone");
  });

  test("carries a caller-supplied header through to the request", async () => {
    const fetchStub = stubFetch(async () => jsonResponse(answer(0.9)));
    const estimator = createJevEstimator({
      apiKey: "key",
      headers: { "X-Test": "1" },
      fetch: fetchStub,
    });

    await estimator.estimate(request);

    const [, init] = fetchStub.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Test")).toBe("1");
  });

  test("puts the model, subject and single question into the request body", async () => {
    const fetchStub = stubFetch(async () => jsonResponse(answer(0.9)));
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await estimator.estimate(request);

    const [, init] = fetchStub.mock.calls[0];
    if (init === undefined) throw new Error("init not captured");
    const body = JSON.parse(init.body as string) as {
      model: string;
      state: string;
      questions: Record<string, { type: string; instructions: string }>;
    };
    expect(body.model).toBe("jev-latest");
    expect(body.state).toBe("T");
    expect(Object.keys(body.questions)).toEqual(["answer"]);
    expect(body.questions.answer.type).toBe("noul");
    expect(body.questions.answer.instructions).toBe("Q");
  });

  test("sends a structured subject as the request state unchanged, not as a string", async () => {
    const fetchStub = stubFetch(async () => jsonResponse(answer(0.9)));
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await estimator.estimate({
      subject: { kind: "note", text: "hi" },
      question: "Q",
    });

    const [, init] = fetchStub.mock.calls[0];
    if (init === undefined) throw new Error("init not captured");
    const body = JSON.parse(init.body as string) as { state: unknown };
    expect(body.state).toEqual({ kind: "note", text: "hi" });
    expect(typeof body.state).not.toBe("string");
  });

  test("sends an array subject as the request state unchanged", async () => {
    const fetchStub = stubFetch(async () => jsonResponse(answer(0.9)));
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await estimator.estimate({
      subject: ["a", { b: 1 }],
      question: "Q",
    });

    const [, init] = fetchStub.mock.calls[0];
    if (init === undefined) throw new Error("init not captured");
    const body = JSON.parse(init.body as string) as { state: unknown };
    expect(body.state).toEqual(["a", { b: 1 }]);
  });

  test("defaults the model to jev-latest, and a custom model is both named and sent", async () => {
    const fetchStub = stubFetch(async () => jsonResponse(answer(0.9)));
    const defaultEstimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });
    expect(defaultEstimator.model).toBe("jev-latest");

    const customEstimator = createJevEstimator({
      apiKey: "key",
      model: "jev-x",
      fetch: fetchStub,
    });
    expect(customEstimator.model).toBe("jev-x");

    await customEstimator.estimate(request);

    const [, init] = fetchStub.mock.calls[0];
    if (init === undefined) throw new Error("init not captured");
    const body = JSON.parse(init.body as string) as { model: string };
    expect(body.model).toBe("jev-x");
  });

  test("returns the response probability as-is, including the 0 and 1 boundaries", async () => {
    const fetchStub = stubFetch(async () => jsonResponse(answer(0.93)));
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await expect(estimator.estimate(request)).resolves.toEqual({
      probability: 0.93,
    });

    fetchStub.mockResolvedValueOnce(jsonResponse(answer(0)));
    await expect(estimator.estimate(request)).resolves.toEqual({
      probability: 0,
    });

    fetchStub.mockResolvedValueOnce(jsonResponse(answer(1)));
    await expect(estimator.estimate(request)).resolves.toEqual({
      probability: 1,
    });
  });

  test("reads the probability from a response with the fields the service sends alongside it", async () => {
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(async () =>
        jsonResponse({
          model: "jev-1.13.0",
          answers: { answer: { type: "noul", noul: 0.98 } },
          usage: { input_tokens: 293, output_tokens: 20 },
        }),
      ),
    });

    await expect(estimator.estimate(request)).resolves.toEqual({
      probability: 0.98,
    });
  });

  test("throws EstimatorRequestError with the status in its words and a JevHttpError as cause on a non-2xx response", async () => {
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(
        async () => new Response("upstream busy", { status: 503 }),
      ),
    });

    const error = await estimator
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorRequestError);
    const requestError = error as EstimatorRequestError;
    expect(requestError.message).toBe(
      "Jev request failed: 503: upstream busy",
    );
    expect(requestError.messageWithoutServiceText).toBe(
      "Jev request failed: 503: (text from the service left out)",
    );
    expect(requestError.retryable).toBe(true);
    expect(requestError.retryAfterMs).toBeUndefined();
    const cause = requestError.cause as JevHttpError;
    expect(cause).toBeInstanceOf(JevHttpError);
    expect(cause.name).toBe("JevHttpError");
    expect(cause.status).toBe(503);
    expect(cause.body).toBe("upstream busy");
    expect(cause.message).toBe("upstream busy");
    expect(cause.cause).toBeUndefined();
    expect(isEstimatorError(cause)).toBe(false);
  });

  test("states the status alone in both texts when the failed response body is empty", async () => {
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(async () => new Response("", { status: 502 })),
    });

    const error = await estimator
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    const requestError = error as EstimatorRequestError;
    expect(requestError.message).toBe("Jev request failed: 502");
    expect(requestError.messageWithoutServiceText).toBe(
      "Jev request failed: 502",
    );
    expect((requestError.cause as JevHttpError).message).toBe("");
    expect((requestError.cause as JevHttpError).body).toBe("");
  });

  test("marks 429 retryable with its Retry-After and 400 not retryable", async () => {
    const tooMany = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(
        async () =>
          new Response("slow down", {
            status: 429,
            headers: { "Retry-After": "2" },
          }),
      ),
    });
    const tooManyError = (await tooMany
      .estimate(request)
      .catch((thrown: unknown) => thrown)) as EstimatorRequestError;

    expect(tooManyError.retryable).toBe(true);
    expect(tooManyError.retryAfterMs).toBe(2000);
    expect(tooManyError.message).toBe(
      "Jev request failed: 429: slow down",
    );

    const badRequest = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(
        async () => new Response("bad", { status: 400 }),
      ),
    });
    const badError = (await badRequest
      .estimate(request)
      .catch((thrown: unknown) => thrown)) as EstimatorRequestError;

    expect(badError.retryable).toBe(false);
    expect(badError.retryAfterMs).toBeUndefined();
    expect(badError.message).toBe("Jev request failed: 400: bad");
  });

  test("cuts the body snippet at 200 characters and keeps the whole body on the cause", async () => {
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(
        async () => new Response("a".repeat(300), { status: 500 }),
      ),
    });

    const error = (await estimator
      .estimate(request)
      .catch((thrown: unknown) => thrown)) as EstimatorRequestError;

    const cause = error.cause as JevHttpError;
    expect(cause.body).toHaveLength(300);
    expect(cause.message).toBe(
      `${"a".repeat(200)} (body cut at 200 characters)`,
    );
    expect(error.message).toBe(
      `Jev request failed: 500: ${"a".repeat(200)} (body cut at 200 characters)`,
    );
    expect(error.messageWithoutServiceText).toBe(
      "Jev request failed: 500: (text from the service left out)",
    );

    const exact = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(
        async () => new Response("a".repeat(200), { status: 500 }),
      ),
    });
    const exactError = (await exact
      .estimate(request)
      .catch((thrown: unknown) => thrown)) as EstimatorRequestError;

    expect((exactError.cause as JevHttpError).message).toBe(
      "a".repeat(200),
    );
  });

  test("leaves the parser's message out of messageWithoutServiceText when the body is not JSON", async () => {
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(
        async () =>
          new Response("<html><body>hello</body></html>", {
            status: 200,
          }),
      ),
    });

    const error = await estimator
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    expect(
      (error as EstimatorResponseError).messageWithoutServiceText,
    ).toBe(
      "Jev response is not JSON: (text from the service left out)",
    );
  });

  test("throws EstimatorRequestError with the rejection as cause and both texts equal when the transport function rejects", async () => {
    const original = new TypeError("fetch failed", {
      cause: Object.assign(
        new Error("connect ECONNREFUSED 127.0.0.1:59999"),
        { code: "ECONNREFUSED" },
      ),
    });
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(async () => {
        throw original;
      }),
    });

    const error = await estimator
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorRequestError);
    const requestError = error as EstimatorRequestError;
    expect(requestError.message).toBe(
      "Jev request failed: fetch failed: connect ECONNREFUSED 127.0.0.1:59999",
    );
    expect(requestError.messageWithoutServiceText).toBe(
      "Jev request failed: fetch failed: connect ECONNREFUSED 127.0.0.1:59999",
    );
    expect(requestError.retryable).toBe(true);
    expect(requestError.retryAfterMs).toBeUndefined();
    expect(requestError.cause).toBe(original);
  });

  test("marks a send failure retryable only when its cause code is a connection or lookup failure", async () => {
    const retryableOf = async (code: string): Promise<unknown> => {
      const estimator = createJevEstimator({
        apiKey: "key",
        fetch: stubFetch(async () => {
          throw new TypeError("fetch failed", {
            cause: Object.assign(new Error(code), { code }),
          });
        }),
      });
      const error = (await estimator
        .estimate(request)
        .catch((thrown: unknown) => thrown)) as EstimatorRequestError;
      expect(error.message).toBe(
        `Jev request failed: fetch failed: ${code}`,
      );
      return error.retryable;
    };

    for (const code of [
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "UND_ERR_SOCKET",
      "UND_ERR_CONNECT_TIMEOUT",
    ]) {
      expect(await retryableOf(code)).toBe(true);
    }
    for (const code of [
      "ENOTFOUND",
      "CERT_HAS_EXPIRED",
      "ERR_INVALID_URL",
      "UND_ERR_INVALID_ARG",
    ]) {
      expect(await retryableOf(code)).toBe(false);
    }
  });

  test("marks 408 retryable with its Retry-After", async () => {
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(
        async () =>
          new Response("timed out", {
            status: 408,
            headers: { "Retry-After": "3" },
          }),
      ),
    });

    const error = (await estimator
      .estimate(request)
      .catch((thrown: unknown) => thrown)) as EstimatorRequestError;

    expect(error.message).toBe("Jev request failed: 408: timed out");
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(3000);
  });

  test("throws EstimatorResponseError when the response body is not JSON", async () => {
    const fetchStub = stubFetch(
      async () => new Response("not json", { status: 200 }),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      `Jev response is not JSON: Unexpected token 'o', "not json" is not valid JSON`,
    );
  });

  test("throws EstimatorResponseError when the response body has the wrong shape", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse({ answers: {} }),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation",
    );
  });

  test("throws EstimatorResponseError when the probability is out of range or not a number", async () => {
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(async () => jsonResponse(answer(1.5))),
    });
    await expect(estimator.estimate(request)).rejects.toBeInstanceOf(
      EstimatorResponseError,
    );

    const estimatorNegative = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(async () => jsonResponse(answer(-0.1))),
    });
    await expect(
      estimatorNegative.estimate(request),
    ).rejects.toBeInstanceOf(EstimatorResponseError);

    const estimatorString = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(async () => jsonResponse(answer("0.5"))),
    });
    await expect(
      estimatorString.estimate(request),
    ).rejects.toBeInstanceOf(EstimatorResponseError);
  });

  test("throws EstimatorResponseError when the answer type is not noul", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse({
        answers: { answer: { type: "text", noul: 0.5 } },
      }),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await expect(estimator.estimate(request)).rejects.toBeInstanceOf(
      EstimatorResponseError,
    );
  });

  test("rejects with the abort reason without calling fetch when the signal is already aborted", async () => {
    const fetchStub = stubFetch(async () => jsonResponse(answer(0.9)));
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });
    const controller = new AbortController();
    controller.abort();

    const error = await estimator
      .estimate(request, { signal: controller.signal })
      .catch((thrown: unknown) => thrown);

    expect(error).toBe(controller.signal.reason);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test("passes the caller's signal through to the transport function unchanged", async () => {
    const fetchStub = stubFetch(async () => jsonResponse(answer(0.9)));
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });
    const controller = new AbortController();

    await estimator.estimate(request, { signal: controller.signal });

    const [, init] = fetchStub.mock.calls[0];
    expect(init?.signal).toBe(controller.signal);
  });

  test("lets an AbortError from the transport function through unwrapped", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const fetchStub = stubFetch(async () => {
      throw abortError;
    });
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await expect(estimator.estimate(request)).rejects.toBe(abortError);
  });

  test("lets an abort while reading the failed response body through unchanged", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const response = new Response(null, { status: 500 });
    vi.spyOn(response, "text").mockRejectedValue(abortError);
    const fetchStub = stubFetch(async () => response);
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await expect(estimator.estimate(request)).rejects.toBe(abortError);
  });

  test("throws the signal's reason when the caller aborts with a plain object while sending", async () => {
    const reason = { why: "user left" };
    const controller = new AbortController();
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(async () => {
        controller.abort(reason);
        throw new TypeError("fetch failed");
      }),
    });

    await expect(
      estimator.estimate(request, { signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  test("throws the signal's reason when the caller aborts while reading a failed response body", async () => {
    const reason = { why: "user left" };
    const controller = new AbortController();
    const response = new Response(null, { status: 500 });
    vi.spyOn(response, "text").mockImplementation(async () => {
      controller.abort(reason);
      throw new Error("read failed");
    });
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(async () => response),
    });

    await expect(
      estimator.estimate(request, { signal: controller.signal }),
    ).rejects.toBe(reason);
  });
});

describe("a failed response whose body cannot be read", () => {
  test("reports the status and the read failure, retryable by status, without a JevHttpError", async () => {
    const readError = new TypeError("terminated: other side closed");
    const response = new Response(null, { status: 503 });
    vi.spyOn(response, "text").mockRejectedValue(readError);
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(async () => response),
    });

    const error = await estimator
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    const requestError = error as EstimatorRequestError;
    expect(requestError).toBeInstanceOf(EstimatorRequestError);
    expect(requestError.message).toBe(
      "Jev request failed: 503; the body could not be read: terminated: other side closed",
    );
    expect(requestError.messageWithoutServiceText).toBe(
      "Jev request failed: 503; the body could not be read: terminated: other side closed",
    );
    expect(requestError.retryable).toBe(true);
    expect(requestError.cause).toBe(readError);
  });

  test("is not retryable when the status is 400", async () => {
    const response = new Response(null, { status: 400 });
    vi.spyOn(response, "text").mockRejectedValue(new Error("boom"));
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(async () => response),
    });

    const error = await estimator
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    expect((error as EstimatorRequestError).retryable).toBe(false);
  });
});

describe("retryable failures and retryAfterMs", () => {
  test("reads a Retry-After given in seconds as milliseconds, with 0 seconds giving 0", async () => {
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(
        async () =>
          new Response("busy", {
            status: 503,
            headers: { "Retry-After": "2" },
          }),
      ),
    });

    const error = await estimator
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    expect((error as EstimatorRequestError).retryAfterMs).toBe(2000);

    const zeroEstimator = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(
        async () =>
          new Response("busy", {
            status: 503,
            headers: { "Retry-After": "0" },
          }),
      ),
    });

    const zeroError = await zeroEstimator
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    expect((zeroError as EstimatorRequestError).retryAfterMs).toBe(0);
  });

  test("reads a Retry-After given as an HTTP date as the time until that date, clamped to 0 in the past", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    try {
      const futureEstimator = createJevEstimator({
        apiKey: "key",
        fetch: stubFetch(
          async () =>
            new Response("busy", {
              status: 503,
              headers: {
                "Retry-After": "Thu, 01 Jan 2026 00:00:05 GMT",
              },
            }),
        ),
      });

      const futureError = await futureEstimator
        .estimate(request)
        .catch((thrown: unknown) => thrown);

      expect((futureError as EstimatorRequestError).retryAfterMs).toBe(
        5000,
      );

      const pastEstimator = createJevEstimator({
        apiKey: "key",
        fetch: stubFetch(
          async () =>
            new Response("busy", {
              status: 503,
              headers: {
                "Retry-After": "Wed, 31 Dec 2025 23:59:00 GMT",
              },
            }),
        ),
      });

      const pastError = await pastEstimator
        .estimate(request)
        .catch((thrown: unknown) => thrown);

      expect((pastError as EstimatorRequestError).retryAfterMs).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("reads a Retry-After given in the RFC 850 or asctime date form as a past date, giving 0", async () => {
    for (const retryAfter of [
      "Wednesday, 21-Oct-15 07:28:00 GMT",
      "Wed Oct 21 07:28:00 2015",
    ]) {
      const estimator = createJevEstimator({
        apiKey: "key",
        fetch: stubFetch(
          async () =>
            new Response("busy", {
              status: 503,
              headers: { "Retry-After": retryAfter },
            }),
        ),
      });

      const error = await estimator
        .estimate(request)
        .catch((thrown: unknown) => thrown);

      expect((error as EstimatorRequestError).retryAfterMs).toBe(0);
    }
  });

  test("marks the failure as retryable without a retryAfterMs when Retry-After cannot be read as seconds or an HTTP date", async () => {
    for (const retryAfter of ["soon", "-1", "1.5"]) {
      const estimator = createJevEstimator({
        apiKey: "key",
        fetch: stubFetch(
          async () =>
            new Response("busy", {
              status: 503,
              headers: { "Retry-After": retryAfter },
            }),
        ),
      });

      const error = await estimator
        .estimate(request)
        .catch((thrown: unknown) => thrown);

      expect((error as EstimatorRequestError).retryable).toBe(true);
      expect(
        (error as EstimatorRequestError).retryAfterMs,
      ).toBeUndefined();
    }
  });

  test("leaves non-429/5xx failure responses not retryable, without a retryAfterMs even when Retry-After is present", async () => {
    for (const status of [400, 401, 404, 499]) {
      const estimator = createJevEstimator({
        apiKey: "key",
        fetch: stubFetch(async () => new Response("nope", { status })),
      });

      const error = await estimator
        .estimate(request)
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(EstimatorRequestError);
      expect((error as EstimatorRequestError).retryable).toBe(false);
    }

    const withRetryAfter = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(
        async () =>
          new Response("nope", {
            status: 400,
            headers: { "Retry-After": "2" },
          }),
      ),
    });

    const error = await withRetryAfter
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorRequestError);
    expect((error as EstimatorRequestError).retryable).toBe(false);
    expect(
      (error as EstimatorRequestError).retryAfterMs,
    ).toBeUndefined();
  });

  test("leaves a response failure not retryable when the body is not JSON or the probability is out of range", async () => {
    const notJsonEstimator = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(
        async () => new Response("not json", { status: 200 }),
      ),
    });

    const notJsonError = await notJsonEstimator
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    expect(notJsonError).toBeInstanceOf(EstimatorResponseError);
    expect((notJsonError as EstimatorResponseError).retryable).toBe(
      false,
    );

    const outOfRangeEstimator = createJevEstimator({
      apiKey: "key",
      fetch: stubFetch(async () => jsonResponse(answer(1.5))),
    });

    const outOfRangeError = await outOfRangeEstimator
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    expect(outOfRangeError).toBeInstanceOf(EstimatorResponseError);
    expect((outOfRangeError as EstimatorResponseError).retryable).toBe(
      false,
    );
  });
});

describe("createJevEstimator classify", () => {
  test("declares a limit of 255 labels and 10 levels", () => {
    const estimator = createJevEstimator({ apiKey: "key" });

    expect(estimator.limits).toEqual({ maxLabels: 255, maxLevels: 10 });
  });

  test("sends one POST to the systemone URL with the bearer header, JSON content type, a caller header and the model", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("a", { a: 1 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      baseUrl: "https://example.test/v1/",
      model: "jev-x",
      headers: { "X-Test": "1" },
      fetch: fetchStub,
    });

    await estimator.classify({
      subject: "T",
      question: "Q",
      labels: { a: "first" },
    });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe("https://example.test/v1/systemone");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer key");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Test")).toBe("1");
    if (init === undefined) throw new Error("init not captured");
    const body = JSON.parse(init.body as string) as { model: string };
    expect(body.model).toBe("jev-x");
  });

  test("puts the model, subject and a choice question named answer with the labels as criteria into the request body", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("a", { a: 1, b: 0 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await estimator.classify({
      subject: "T",
      question: "Q",
      labels: { a: "first", b: "second" },
    });

    const [, init] = fetchStub.mock.calls[0];
    if (init === undefined) throw new Error("init not captured");
    const body: unknown = JSON.parse(init.body as string);
    expect(body).toEqual({
      model: "jev-latest",
      state: "T",
      questions: {
        answer: {
          type: "choice",
          instructions: "Q",
          criteria: { a: "first", b: "second" },
        },
      },
    });
  });

  test("sends a structured subject as the request state unchanged, not as a string", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("a", { a: 1 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await estimator.classify({
      subject: { kind: "note", text: "hi" },
      question: "Q",
      labels: { a: "first" },
    });

    const [, init] = fetchStub.mock.calls[0];
    if (init === undefined) throw new Error("init not captured");
    const body = JSON.parse(init.body as string) as { state: unknown };
    expect(body.state).toEqual({ kind: "note", text: "hi" });
    expect(typeof body.state).not.toBe("string");
  });

  test("returns only the chosen label and the labels' probabilities, without the confidence field", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse({
        model: "jev-1.13.0",
        answers: {
          answer: {
            type: "choice",
            choice: "a",
            confidence: 0.9,
            probabilities: { a: 0.7, b: 0.3 },
          },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const classification = await estimator.classify(classifyRequest);

    expect(classification).toEqual({
      label: "a",
      probabilities: { a: 0.7, b: 0.3 },
    });
    expect(classification).not.toHaveProperty("confidence");
  });

  test("rejects an empty labels map with a RangeError before calling fetch", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("a", { a: 1 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .classify({ subject: "T", question: "Q", labels: {} })
      .catch((thrown: unknown) => thrown);

    expect(fetchStub).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(RangeError);
    expect((error as RangeError).message).toBe(
      "labels has 0 entries; at least 1 is required",
    );
  });

  test("rejects a labels map beyond the declared limit with a RangeError before calling fetch", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("l0", { l0: 1 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });
    const labels: Record<string, string> = {};
    for (let i = 0; i < 256; i++) labels[`l${i}`] = "x";

    const error = await estimator
      .classify({ subject: "T", question: "Q", labels })
      .catch((thrown: unknown) => thrown);

    expect(fetchStub).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(RangeError);
    expect((error as RangeError).message).toBe(
      "labels has 256 entries; the estimator accepts at most 255",
    );
  });

  test("sends a request at exactly the label limit", async () => {
    const labels: Record<string, string> = {};
    for (let i = 0; i < 255; i++) labels[`l${i}`] = "x";
    const probabilities: Record<string, number> = {};
    for (const key of Object.keys(labels)) probabilities[key] = 0;
    probabilities["l0"] = 1;
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("l0", probabilities)),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await estimator.classify({ subject: "T", question: "Q", labels });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [, init] = fetchStub.mock.calls[0];
    if (init === undefined) throw new Error("init not captured");
    const body = JSON.parse(init.body as string) as {
      questions: { answer: { criteria: Record<string, string> } };
    };
    expect(Object.keys(body.questions.answer.criteria)).toHaveLength(
      255,
    );
  });

  test("sends an empty subject, question and label unchanged", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("", { "": 1 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await estimator.classify({
      subject: "",
      question: "",
      labels: { "": "" },
    });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [, init] = fetchStub.mock.calls[0];
    if (init === undefined) throw new Error("init not captured");
    const body: unknown = JSON.parse(init.body as string);
    expect(body).toEqual({
      model: "jev-latest",
      state: "",
      questions: {
        answer: {
          type: "choice",
          instructions: "",
          criteria: { "": "" },
        },
      },
    });
  });

  test("throws EstimatorResponseError when the answer type is not choice", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse({
        answers: { answer: { type: "noul", noul: 0.5 } },
      }),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .classify(classifyRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation: answer is missing or not of type choice",
    );
  });

  test("throws EstimatorResponseError when there is no answer at all", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse({ answers: {} }),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .classify(classifyRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation: answer is missing or not of type choice",
    );
  });

  test("throws EstimatorResponseError when the chosen label is not a string", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer(1, { a: 1 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .classify(classifyRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation: answer is missing or not of type choice",
    );
  });

  test("throws EstimatorResponseError when probabilities is not an object", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("a", "x")),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .classify(classifyRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation: answer is missing or not of type choice",
    );
  });

  test("throws EstimatorResponseError when the chosen label is not among the labels", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("c", { a: 0.5, b: 0.5 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .classify(classifyRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      'Jev response failed validation: chosen label "c" is not among the labels',
    );
    expect(
      (error as EstimatorResponseError).messageWithoutServiceText,
    ).toBe(
      'Jev response failed validation: chosen label "c" is not among the labels',
    );
  });

  test("leaves the failure not retryable when the chosen label is not among the labels", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("c", { a: 0.5, b: 0.5 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .classify(classifyRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).retryable).toBe(false);
  });

  test("throws EstimatorResponseError when the probabilities are missing a label", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("a", { a: 1 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .classify(classifyRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation: probabilities do not cover exactly the labels",
    );
  });

  test("throws EstimatorResponseError when the probabilities carry an extra key beyond the labels", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("a", { a: 0.5, b: 0.5, c: 0 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .classify(classifyRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation: probabilities do not cover exactly the labels",
    );
  });

  test("throws EstimatorResponseError when a probability is outside 0 to 1", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("a", { a: 1.5, b: 0 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .classify(classifyRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      'Jev response failed validation: probability for "a" is not between 0 and 1',
    );
  });

  test("throws EstimatorResponseError when a probability is a string rather than a number", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("a", { a: "0.5", b: 0.5 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .classify(classifyRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      'Jev response failed validation: probability for "a" is not between 0 and 1',
    );
  });

  test("reports the chosen label mismatch rather than the out-of-range probability when both are wrong", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("c", { a: 1.5 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .classify(classifyRequest)
      .catch((thrown: unknown) => thrown);

    expect((error as EstimatorResponseError).message).toBe(
      'Jev response failed validation: chosen label "c" is not among the labels',
    );
  });

  test("reports the key set mismatch rather than the out-of-range probability when both are wrong", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("a", { a: 1.5 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .classify(classifyRequest)
      .catch((thrown: unknown) => thrown);

    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation: probabilities do not cover exactly the labels",
    );
  });

  test("throws EstimatorResponseError when the response body is not JSON", async () => {
    const fetchStub = stubFetch(
      async () => new Response("not json", { status: 200 }),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .classify(classifyRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      `Jev response is not JSON: Unexpected token 'o', "not json" is not valid JSON`,
    );
  });

  test("passes the caller's signal through to the transport function unchanged", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("a", { a: 1 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });
    const controller = new AbortController();

    await estimator.classify(
      { subject: "T", question: "Q", labels: { a: "x" } },
      { signal: controller.signal },
    );

    const [, init] = fetchStub.mock.calls[0];
    expect(init?.signal).toBe(controller.signal);
  });

  test("lets an AbortError from the transport function through unwrapped", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const fetchStub = stubFetch(async () => {
      throw abortError;
    });
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await expect(estimator.classify(classifyRequest)).rejects.toBe(
      abortError,
    );
  });

  test("rejects with the abort reason without calling fetch when the signal is already aborted", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("a", { a: 1 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });
    const controller = new AbortController();
    controller.abort("stop");

    const error = await estimator
      .classify(classifyRequest, { signal: controller.signal })
      .catch((thrown: unknown) => thrown);

    expect(error).toBe("stop");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test("rejects with the abort reason, not a RangeError, when the signal is aborted and the labels are also invalid", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(choiceAnswer("a", { a: 1 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });
    const controller = new AbortController();
    controller.abort("stop");

    const error = await estimator
      .classify(
        { subject: "T", question: "Q", labels: {} },
        { signal: controller.signal },
      )
      .catch((thrown: unknown) => thrown);

    expect(error).toBe("stop");
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("createJevEstimator score", () => {
  test("sends one POST to the systemone URL with the bearer header, JSON content type, a caller header and the model", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(1, { "0": 0.5, "1": 0.5 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      baseUrl: "https://example.test/v1/",
      model: "jev-x",
      headers: { "X-Test": "1" },
      fetch: fetchStub,
    });

    await estimator.score({
      subject: "T",
      question: "Q",
      levels: ["low", "high"],
    });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe("https://example.test/v1/systemone");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer key");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Test")).toBe("1");
    if (init === undefined) throw new Error("init not captured");
    const body = JSON.parse(init.body as string) as { model: string };
    expect(body.model).toBe("jev-x");
  });

  test("puts the model, subject and a score question named answer with the levels as criteria into the request body", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(1, { "0": 0.2, "1": 0.5, "2": 0.3 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await estimator.score({
      subject: "T",
      question: "Q",
      levels: ["low", "mid", "high"],
    });

    const [, init] = fetchStub.mock.calls[0];
    if (init === undefined) throw new Error("init not captured");
    const body: unknown = JSON.parse(init.body as string);
    expect(body).toEqual({
      model: "jev-latest",
      state: "T",
      questions: {
        answer: {
          type: "score",
          instructions: "Q",
          criteria: ["low", "mid", "high"],
        },
      },
    });
  });

  test("sends a structured subject as the request state unchanged, not as a string", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(1, { "0": 0.2, "1": 0.5, "2": 0.3 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await estimator.score({
      subject: { kind: "note", text: "hi" },
      question: "Q",
      levels: ["low", "mid", "high"],
    });

    const [, init] = fetchStub.mock.calls[0];
    if (init === undefined) throw new Error("init not captured");
    const body = JSON.parse(init.body as string) as { state: unknown };
    expect(body.state).toEqual({ kind: "note", text: "hi" });
    expect(typeof body.state).not.toBe("string");
  });

  test("returns only the score and the levels' probabilities, without the confidence or legend fields", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse({
        answers: {
          answer: {
            type: "score",
            score: 1.09,
            confidence: 0.87,
            legend: { "0": "low", "1": "mid", "2": "high" },
            probabilities: { "0": 0.1, "1": 0.71, "2": 0.19 },
          },
        },
      }),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const score = await estimator.score({
      subject: "T",
      question: "Q",
      levels: ["low", "mid", "high"],
    });

    expect(score).toEqual({
      score: 1.09,
      probabilities: [0.1, 0.71, 0.19],
    });
    expect(score).not.toHaveProperty("confidence");
    expect(score).not.toHaveProperty("legend");
  });

  test("rejects a levels array beyond the declared limit with a RangeError before calling fetch", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(0, { "0": 1 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });
    const levels = Array.from({ length: 11 }, (_, i) => `l${i}`) as [
      string,
      string,
      ...string[],
    ];

    const error = await estimator
      .score({ subject: "T", question: "Q", levels })
      .catch((thrown: unknown) => thrown);

    expect(fetchStub).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(RangeError);
    expect((error as RangeError).message).toBe(
      "levels has 11 entries; the estimator accepts at most 10",
    );
  });

  test("sends a request at exactly the level limit", async () => {
    const levels = Array.from({ length: 10 }, (_, i) => `l${i}`) as [
      string,
      string,
      ...string[],
    ];
    const probabilities: Record<string, number> = {};
    for (let i = 0; i < levels.length; i++)
      probabilities[String(i)] = 0;
    probabilities["0"] = 1;
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(0, probabilities)),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await estimator.score({ subject: "T", question: "Q", levels });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [, init] = fetchStub.mock.calls[0];
    if (init === undefined) throw new Error("init not captured");
    const body = JSON.parse(init.body as string) as {
      questions: { answer: { criteria: string[] } };
    };
    expect(body.questions.answer.criteria).toHaveLength(10);
  });

  test("sends an empty subject, question and levels unchanged", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(0, { "0": 1, "1": 0 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await estimator.score({
      subject: "",
      question: "",
      levels: ["", ""],
    });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [, init] = fetchStub.mock.calls[0];
    if (init === undefined) throw new Error("init not captured");
    const body: unknown = JSON.parse(init.body as string);
    expect(body).toEqual({
      model: "jev-latest",
      state: "",
      questions: {
        answer: {
          type: "score",
          instructions: "",
          criteria: ["", ""],
        },
      },
    });
  });

  test("throws EstimatorResponseError when the answer type is not score", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse({
        answers: {
          answer: {
            type: "choice",
            choice: "a",
            confidence: 1,
            probabilities: { a: 1 },
          },
        },
      }),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .score(scoreRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation: answer is missing or not of type score",
    );
  });

  test("throws EstimatorResponseError when there is no answer at all", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse({ answers: {} }),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .score(scoreRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation: answer is missing or not of type score",
    );
  });

  test("throws EstimatorResponseError when the score is not a number", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer("1", { "0": 1, "1": 0 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .score(scoreRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation: answer is missing or not of type score",
    );
  });

  test("throws EstimatorResponseError when probabilities is not an object", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(1, "x")),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .score(scoreRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation: answer is missing or not of type score",
    );
  });

  test("throws EstimatorResponseError when the probabilities are missing a level", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(1, { "0": 0.5, "1": 0.5 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .score(scoreRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation: probabilities do not cover exactly the levels",
    );
  });

  test("throws EstimatorResponseError when the probabilities carry an extra key beyond the levels", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(
        scoreAnswer(1, { "0": 0.5, "1": 0.3, "2": 0.2, "3": 0 }),
      ),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .score(scoreRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation: probabilities do not cover exactly the levels",
    );
  });

  test("throws EstimatorResponseError when a probability is above 1", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(1, { "0": 0.2, "1": 1.1 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .score({ subject: "T", question: "Q", levels: ["a", "b"] })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      'Jev response failed validation: probability for "1" is not between 0 and 1',
    );
  });

  test("throws EstimatorResponseError when a probability is below 0", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(1, { "0": -0.1, "1": 0.5 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .score({ subject: "T", question: "Q", levels: ["a", "b"] })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      'Jev response failed validation: probability for "0" is not between 0 and 1',
    );
  });

  test("throws EstimatorResponseError when a probability is a string rather than a number", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(1, { "0": "0.5", "1": 0.5 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .score({ subject: "T", question: "Q", levels: ["a", "b"] })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      'Jev response failed validation: probability for "0" is not between 0 and 1',
    );
  });

  test("throws EstimatorResponseError when the score is above the top level", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(2.5, { "0": 0, "1": 0, "2": 1 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .score(scoreRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation: score 2.5 is outside the levels",
    );
  });

  test("leaves the failure not retryable when the score is outside the levels", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(2.5, { "0": 0, "1": 0, "2": 1 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .score(scoreRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).retryable).toBe(false);
  });

  test("throws EstimatorResponseError when the score is below 0", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(-0.1, { "0": 1, "1": 0 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .score({ subject: "T", question: "Q", levels: ["a", "b"] })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation: score -0.1 is outside the levels",
    );
  });

  test("reports the key set mismatch rather than the out-of-range probability when both are wrong", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(5, { "0": 1.5 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .score({ subject: "T", question: "Q", levels: ["a", "b"] })
      .catch((thrown: unknown) => thrown);

    expect((error as EstimatorResponseError).message).toBe(
      "Jev response failed validation: probabilities do not cover exactly the levels",
    );
  });

  test("reports the out-of-range probability rather than the out-of-range score when both are wrong", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(5, { "0": 1.5, "1": 0 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .score({ subject: "T", question: "Q", levels: ["a", "b"] })
      .catch((thrown: unknown) => thrown);

    expect((error as EstimatorResponseError).message).toBe(
      'Jev response failed validation: probability for "0" is not between 0 and 1',
    );
  });

  test("throws EstimatorResponseError when the response body is not JSON", async () => {
    const fetchStub = stubFetch(
      async () => new Response("not json", { status: 200 }),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .score(scoreRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect((error as EstimatorResponseError).message).toBe(
      `Jev response is not JSON: Unexpected token 'o', "not json" is not valid JSON`,
    );
  });

  test("passes the caller's signal through to the transport function unchanged", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(1, { "0": 0.5, "1": 0.5 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });
    const controller = new AbortController();

    await estimator.score(
      { subject: "T", question: "Q", levels: ["a", "b"] },
      { signal: controller.signal },
    );

    const [, init] = fetchStub.mock.calls[0];
    expect(init?.signal).toBe(controller.signal);
  });

  test("lets an AbortError from the transport function through unwrapped", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const fetchStub = stubFetch(async () => {
      throw abortError;
    });
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    await expect(estimator.score(scoreRequest)).rejects.toBe(
      abortError,
    );
  });

  test("rejects with the abort reason without calling fetch when the signal is already aborted", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(1, { "0": 0.5, "1": 0.5 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });
    const controller = new AbortController();
    controller.abort("stop");

    const error = await estimator
      .score(scoreRequest, { signal: controller.signal })
      .catch((thrown: unknown) => thrown);

    expect(error).toBe("stop");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  test("rejects with the abort reason, not a RangeError, when the signal is aborted and the levels are also invalid", async () => {
    const fetchStub = stubFetch(async () =>
      jsonResponse(scoreAnswer(0, { "0": 1 })),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });
    const controller = new AbortController();
    controller.abort("stop");
    const levels = Array.from({ length: 11 }, (_, i) => `l${i}`) as [
      string,
      string,
      ...string[],
    ];

    const error = await estimator
      .score(
        { subject: "T", question: "Q", levels },
        { signal: controller.signal },
      )
      .catch((thrown: unknown) => thrown);

    expect(error).toBe("stop");
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("reading the response body", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  const serve = async (
    handler: (
      req: IncomingMessage,
      res: ServerResponse,
      count: number,
    ) => void,
  ): Promise<{ baseUrl: string; requests: () => number }> => {
    let count = 0;
    const server = createServer((req, res) => {
      count += 1;
      req.resume();
      req.on("end", () => handler(req, res, count));
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    return {
      baseUrl: `http://127.0.0.1:${port}`,
      requests: () => count,
    };
  };

  const cutAfterPartialBody = (res: ServerResponse): void => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"answers":');
    setTimeout(() => res.socket?.destroy(), 20);
  };

  const rejection = (promise: Promise<unknown>): Promise<unknown> =>
    promise.catch((thrown: unknown) => thrown);

  test("retryable request error when the connection is cut while reading the body", async () => {
    const { baseUrl } = await serve((_req, res) =>
      cutAfterPartialBody(res),
    );
    const estimator = createJevEstimator({ apiKey: "key", baseUrl });

    const error = (await rejection(
      estimator.estimate(request),
    )) as EstimatorRequestError;

    expect(error).toBeInstanceOf(EstimatorRequestError);
    expect(error.message).toBe(
      "Jev response body could not be read: terminated: other side closed",
    );
    expect(error.messageWithoutServiceText).toBe(
      "Jev response body could not be read: terminated: other side closed",
    );
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBeUndefined();
    const cause = error.cause as TypeError & {
      cause: { code: string };
    };
    expect(cause).toBeInstanceOf(TypeError);
    expect(cause.message).toBe("terminated");
    expect(cause.cause.code).toBe("UND_ERR_SOCKET");
  });

  test("retrying estimator returns the next answer after a cut body", async () => {
    const { baseUrl, requests } = await serve((_req, res, count) => {
      if (count === 1) {
        cutAfterPartialBody(res);
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"answers":{"answer":{"type":"noul","noul":0.7}}}');
    });
    const estimator = createRetryingEstimator({
      estimator: createJevEstimator({ apiKey: "key", baseUrl }),
      maxAttempts: 2,
      delaysMs: [0],
      maxDelayMs: 0,
    });

    await expect(estimator.estimate(request)).resolves.toEqual({
      probability: 0.7,
    });
    expect(requests()).toBe(2);
  });

  test("non-retryable response error when the body cannot be decoded", async () => {
    const { baseUrl } = await serve((_req, res) => {
      res.writeHead(200, { "Content-Encoding": "gzip" });
      res.end("not gzip at all");
    });
    const estimator = createJevEstimator({ apiKey: "key", baseUrl });

    const error = (await rejection(
      estimator.estimate(request),
    )) as EstimatorResponseError;

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(
      /^Jev response body could not be read: /,
    );
    expect(error.messageWithoutServiceText).toBe(error.message);
    expect((error.cause as TypeError).message).toBe("terminated");
  });

  test("non-retryable response error when the body stream errors", async () => {
    const broken = new Error("broken");
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: async () =>
        new Response(
          new ReadableStream({
            start: (controller) => controller.error(broken),
          }),
          { status: 200 },
        ),
    });

    const error = (await rejection(
      estimator.estimate(request),
    )) as EstimatorResponseError;

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect(error.message).toBe(
      "Jev response body could not be read: broken",
    );
    expect(error.messageWithoutServiceText).toBe(
      "Jev response body could not be read: broken",
    );
    expect(error.retryable).toBe(false);
    expect(error.cause).toBe(broken);
  });

  test("not-JSON error for a body that ends partway through a string", async () => {
    const { baseUrl } = await serve((_req, res) => {
      res.writeHead(200, { Connection: "close" });
      res.write('{"a":"hel');
      res.end();
    });
    const estimator = createJevEstimator({ apiKey: "key", baseUrl });

    const error = (await rejection(
      estimator.estimate(request),
    )) as EstimatorResponseError;

    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect(error.message).toBe(
      "Jev response is not JSON: Unterminated string in JSON at position 9 (line 1 column 10)",
    );
    expect(error.messageWithoutServiceText).toBe(
      "Jev response is not JSON: (text from the service left out)",
    );
    expect(error.retryable).toBe(false);
    expect(error.cause).toBeInstanceOf(SyntaxError);
    expect((error.cause as SyntaxError).message).toBe(
      "Unterminated string in JSON at position 9 (line 1 column 10)",
    );
  });

  test("not-JSON error for an HTML body", async () => {
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: async () =>
        new Response("<html><body>hello</body></html>", {
          status: 200,
        }),
    });

    const error = (await rejection(
      estimator.estimate(request),
    )) as EstimatorResponseError;

    const detail = `Unexpected token '<', "<html><bod"... is not valid JSON`;
    expect(error).toBeInstanceOf(EstimatorResponseError);
    expect(error.message).toBe(`Jev response is not JSON: ${detail}`);
    expect(error.cause).toBeInstanceOf(SyntaxError);
    expect((error.cause as SyntaxError).message).toBe(detail);
  });

  test("rejects with a non-Error abort reason when aborted during the body read", async () => {
    const { baseUrl } = await serve((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.flushHeaders();
    });
    const controller = new AbortController();
    const real = globalThis.fetch;
    const estimator = createJevEstimator({
      apiKey: "key",
      baseUrl,
      fetch: async (url, init) => {
        const response = await real(url, init);
        controller.abort({ why: "user" });
        return response;
      },
    });

    const error = await rejection(
      estimator.estimate(request, { signal: controller.signal }),
    );

    expect(error).toBe(controller.signal.reason);
    expect(error).toEqual({ why: "user" });
  });

  test("rejects with a TimeoutError reason when aborted during the body read", async () => {
    const { baseUrl } = await serve((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.flushHeaders();
    });
    const controller = new AbortController();
    const timeout = new DOMException("timed out", "TimeoutError");
    const real = globalThis.fetch;
    const estimator = createJevEstimator({
      apiKey: "key",
      baseUrl,
      fetch: async (url, init) => {
        const response = await real(url, init);
        controller.abort(timeout);
        return response;
      },
    });

    const error = await rejection(
      estimator.estimate(request, { signal: controller.signal }),
    );

    expect(error).toBe(timeout);
    expect((error as DOMException).name).toBe("TimeoutError");
  });

  test("rejects with the signal reason when the body read fails after the signal fired", async () => {
    const controller = new AbortController();
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: async () =>
        new Response(
          new ReadableStream({
            pull: (stream) => {
              controller.abort({ why: "user" });
              stream.error(new Error("boom"));
            },
          }),
          { status: 200 },
        ),
    });

    const error = await rejection(
      estimator.estimate(request, { signal: controller.signal }),
    );

    expect(error).toBe(controller.signal.reason);
  });

  test("passes an AbortError through when the signal has not fired", async () => {
    const aborted = new DOMException("aborted", "AbortError");
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: async () =>
        new Response(
          new ReadableStream({
            start: (controller) => controller.error(aborted),
          }),
          { status: 200 },
        ),
    });

    await expect(estimator.estimate(request)).rejects.toBe(aborted);
    await expect(
      estimator.classify({
        subject: "T",
        question: "Q",
        labels: { yes: "Yes", no: "No" },
      }),
    ).rejects.toBe(aborted);
    await expect(
      estimator.score({
        subject: "T",
        question: "Q",
        levels: ["low", "high"],
      }),
    ).rejects.toBe(aborted);
  });
});
