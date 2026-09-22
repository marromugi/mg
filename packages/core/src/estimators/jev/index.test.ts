import { describe, expect, test, vi } from "vitest";
import {
  EstimatorHttpError,
  EstimatorResponseError,
  EstimatorTransportError,
} from "../errors.js";
import type { ClassifyRequest, EstimateRequest } from "../types.js";
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
      "Jev response is not JSON",
    );
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
      .classify(classifyRequest)
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
      .classify(classifyRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorHttpError);
    expect((error as EstimatorHttpError).message).toBe(
      `Jev request failed: 500 ${"a".repeat(200)}`,
    );
    expect((error as EstimatorHttpError).body).toBe(longBody);
    expect((error as EstimatorHttpError).body).toHaveLength(300);
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
      .classify(classifyRequest)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorTransportError);
    expect((error as EstimatorTransportError).message).toBe(
      "Jev request failed",
    );
    expect((error as EstimatorTransportError).cause).toBe(original);
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

  test("lets an abort while reading the response body through unchanged", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const response = new Response(null, { status: 200 });
    vi.spyOn(response, "json").mockRejectedValue(abortError);
    const fetchStub = stubFetch(async () => response);
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
