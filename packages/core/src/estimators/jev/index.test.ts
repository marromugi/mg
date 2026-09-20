import { describe, expect, test, vi } from "vitest";
import {
  EstimatorHttpError,
  EstimatorResponseError,
  EstimatorTransportError,
} from "../errors.js";
import type { EstimateRequest } from "../types.js";
import { createJevEstimator } from "./index.js";

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

const request: EstimateRequest = { text: "T", question: "Q" };

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

  test("puts the model, text and single question into the request body", async () => {
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

  test("throws EstimatorHttpError with the status and body in the message on a non-2xx response", async () => {
    const fetchStub = stubFetch(
      async () => new Response("boom", { status: 500 }),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorHttpError);
    expect((error as EstimatorHttpError).message).toBe(
      "Jev request failed: 500 boom",
    );
    expect((error as EstimatorHttpError).status).toBe(500);
    expect((error as EstimatorHttpError).body).toBe("boom");
  });

  test("truncates the message to 200 characters of the body but keeps the full body on the error", async () => {
    const longBody = "a".repeat(300);
    const fetchStub = stubFetch(
      async () => new Response(longBody, { status: 500 }),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorHttpError);
    expect((error as EstimatorHttpError).message).toBe(
      `Jev request failed: 500 ${"a".repeat(200)}`,
    );
    expect((error as EstimatorHttpError).body).toBe(longBody);
    expect((error as EstimatorHttpError).body).toHaveLength(300);
  });

  test("omits the trailing space when the failed response body is empty", async () => {
    const fetchStub = stubFetch(
      async () => new Response("", { status: 502 }),
    );
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorHttpError);
    expect((error as EstimatorHttpError).message).toBe(
      "Jev request failed: 502",
    );
  });

  test("throws EstimatorTransportError with the original error as cause when fetch rejects", async () => {
    const original = new Error("network down");
    const fetchStub = stubFetch(async () => {
      throw original;
    });
    const estimator = createJevEstimator({
      apiKey: "key",
      fetch: fetchStub,
    });

    const error = await estimator
      .estimate(request)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorTransportError);
    expect((error as EstimatorTransportError).message).toBe(
      "Jev request failed",
    );
    expect((error as EstimatorTransportError).cause).toBe(original);
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
      "Jev response is not JSON",
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

  test("lets an abort while reading the response body through unchanged", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const response = new Response(null, { status: 200 });
    vi.spyOn(response, "json").mockRejectedValue(abortError);
    const fetchStub = stubFetch(async () => response);
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
});
