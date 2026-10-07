import { describe, expect, test, vi } from "vitest";
import {
  EstimatorResponseError,
  EstimatorRetryExhaustedError,
  EstimatorRequestError,
} from "./errors.js";
import { createJevEstimator } from "./jev/index.js";
import { createRetryingEstimator } from "./retry.js";
import type {
  Classification,
  ClassifyRequest,
  Estimate,
  EstimateOptions,
  EstimateRequest,
  Estimator,
  EstimatorLimits,
  Score,
  ScoreRequest,
} from "./types.js";

type Step<T> = { value: T } | { error: unknown };
type Call = { signal: AbortSignal | undefined };

const scriptedOperation = <T>(
  steps: Step<T>[] | undefined,
  calls: Call[],
) => {
  return async (
    _request: unknown,
    options?: EstimateOptions,
  ): Promise<T> => {
    calls.push({ signal: options?.signal });
    const step = steps?.[calls.length - 1];
    if (!step) {
      throw new Error("scripted estimator ran out of steps");
    }
    if ("error" in step) {
      throw step.error;
    }
    return step.value;
  };
};

type ScriptedEstimator = Estimator & {
  estimateCalls: Call[];
  classifyCalls: Call[];
  scoreCalls: Call[];
};

const createScriptedEstimator = (config: {
  model?: string;
  limits?: EstimatorLimits;
  estimate?: Step<Estimate>[];
  classify?: Step<Classification>[];
  score?: Step<Score>[];
}): ScriptedEstimator => {
  const estimateCalls: Call[] = [];
  const classifyCalls: Call[] = [];
  const scoreCalls: Call[] = [];

  return {
    model: config.model ?? "fake-model",
    limits: config.limits ?? {
      minLabels: 1,
      maxLabels: 7,
      maxLevels: 4,
    },
    estimate: scriptedOperation<Estimate>(
      config.estimate,
      estimateCalls,
    ),
    classify: scriptedOperation<Classification>(
      config.classify,
      classifyCalls,
    ),
    score: scriptedOperation<Score>(config.score, scoreCalls),
    estimateCalls,
    classifyCalls,
    scoreCalls,
  };
};

const estimateRequest: EstimateRequest = {
  subject: "T",
  question: "Q",
};
const classifyRequest: ClassifyRequest = {
  subject: "T",
  question: "Q",
  labels: { yes: "x", no: "y" },
};
const scoreRequest: ScoreRequest = {
  subject: "T",
  question: "Q",
  levels: ["a", "b"],
};

const recordingSleep = (delays: number[]) => {
  return async (ms: number): Promise<void> => {
    delays.push(ms);
  };
};

const retryableTransportError = (retryAfterMs?: number) =>
  new EstimatorRequestError("transport failed", {
    cause: new Error("boom"),
    retryable: true,
    retryAfterMs,
  });

const wrap = (
  estimator: Estimator,
  overrides: Partial<{
    maxAttempts: number;
    delaysMs: readonly number[];
    maxDelayMs: number;
    sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  }> = {},
) =>
  createRetryingEstimator({
    estimator,
    maxAttempts: 3,
    delaysMs: [1000, 2000],
    maxDelayMs: 10000,
    sleep: recordingSleep([]),
    ...overrides,
  });

describe("createRetryingEstimator", () => {
  test("carries the inner estimator's model, limits and results through unchanged", async () => {
    const inner = createScriptedEstimator({
      model: "fake-model",
      limits: { minLabels: 1, maxLabels: 7, maxLevels: 4 },
      estimate: [{ value: { probability: 0.8 } }],
      classify: [
        { value: { label: "yes", probabilities: { yes: 1, no: 0 } } },
      ],
      score: [{ value: { score: 1, probabilities: [0, 1] } }],
    });
    const estimator = wrap(inner);

    expect(estimator.model).toBe("fake-model");
    expect(estimator.limits).toEqual({
      minLabels: 1,
      maxLabels: 7,
      maxLevels: 4,
    });

    await expect(estimator.estimate(estimateRequest)).resolves.toEqual({
      probability: 0.8,
    });
    await expect(estimator.classify(classifyRequest)).resolves.toEqual({
      label: "yes",
      probabilities: { yes: 1, no: 0 },
    });
    await expect(estimator.score(scoreRequest)).resolves.toEqual({
      score: 1,
      probabilities: [0, 1],
    });
  });

  test("passes the caller's abort signal through to the inner estimator unchanged", async () => {
    const inner = createScriptedEstimator({
      estimate: [{ value: { probability: 0.8 } }],
    });
    const estimator = wrap(inner);
    const controller = new AbortController();

    const result = await estimator.estimate(estimateRequest, {
      signal: controller.signal,
    });

    expect(result).toEqual({ probability: 0.8 });
    expect(inner.estimateCalls[0]?.signal).toBe(controller.signal);
  });

  test("rethrows a non-retryable Estimator error without retrying", async () => {
    const error = new EstimatorResponseError("bad shape");
    const inner = createScriptedEstimator({
      estimate: [{ error }],
    });
    const sleep = vi.fn(recordingSleep([]));
    const estimator = wrap(inner, { sleep });

    await expect(estimator.estimate(estimateRequest)).rejects.toBe(
      error,
    );
    expect(inner.estimateCalls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("rethrows an exception that is not an Estimator error without retrying", async () => {
    const error = new RangeError("bad range");
    const inner = createScriptedEstimator({
      estimate: [{ error }],
    });
    const sleep = vi.fn(recordingSleep([]));
    const estimator = wrap(inner, { sleep });

    await expect(estimator.estimate(estimateRequest)).rejects.toBe(
      error,
    );
    expect(inner.estimateCalls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("retries a retryable failure with no wait time using the configured delays, for every operation", async () => {
    const delays: number[] = [];
    const inner = createScriptedEstimator({
      estimate: [
        { error: retryableTransportError() },
        { error: retryableTransportError() },
        { value: { probability: 0.6 } },
      ],
    });
    const estimator = wrap(inner, { sleep: recordingSleep(delays) });

    await expect(estimator.estimate(estimateRequest)).resolves.toEqual({
      probability: 0.6,
    });
    expect(inner.estimateCalls).toHaveLength(3);
    expect(delays).toEqual([1000, 2000]);

    delays.length = 0;
    const classifyInner = createScriptedEstimator({
      classify: [
        { error: retryableTransportError() },
        { error: retryableTransportError() },
        {
          value: { label: "yes", probabilities: { yes: 1, no: 0 } },
        },
      ],
    });
    const classifyEstimator = wrap(classifyInner, {
      sleep: recordingSleep(delays),
    });

    await expect(
      classifyEstimator.classify(classifyRequest),
    ).resolves.toEqual({
      label: "yes",
      probabilities: { yes: 1, no: 0 },
    });
    expect(classifyInner.classifyCalls).toHaveLength(3);
    expect(delays).toEqual([1000, 2000]);

    delays.length = 0;
    const scoreInner = createScriptedEstimator({
      score: [
        { error: retryableTransportError() },
        { error: retryableTransportError() },
        { value: { score: 1, probabilities: [0, 1] } },
      ],
    });
    const scoreEstimator = wrap(scoreInner, {
      sleep: recordingSleep(delays),
    });

    await expect(scoreEstimator.score(scoreRequest)).resolves.toEqual({
      score: 1,
      probabilities: [0, 1],
    });
    expect(scoreInner.scoreCalls).toHaveLength(3);
    expect(delays).toEqual([1000, 2000]);
  });

  test.each([
    [5000, [5000]],
    [10000, [10000]],
    [0, [0]],
  ])(
    "waits the error's own retry-after time of %dms instead of the configured delay",
    async (retryAfterMs, expectedDelays) => {
      const delays: number[] = [];
      const inner = createScriptedEstimator({
        estimate: [
          { error: retryableTransportError(retryAfterMs) },
          { value: { probability: 0.6 } },
        ],
      });
      const estimator = wrap(inner, { sleep: recordingSleep(delays) });

      await expect(
        estimator.estimate(estimateRequest),
      ).resolves.toEqual({ probability: 0.6 });
      expect(delays).toEqual(expectedDelays);
    },
  );

  test("stops at once without waiting when the error's retry-after time exceeds the cap", async () => {
    const error = retryableTransportError(10001);
    const inner = createScriptedEstimator({
      estimate: [{ error }],
    });
    const sleep = vi.fn(recordingSleep([]));
    const estimator = wrap(inner, { sleep });

    const thrown = await estimator
      .estimate(estimateRequest)
      .catch((caught: unknown) => caught);

    expect(thrown).toBeInstanceOf(EstimatorRetryExhaustedError);
    expect((thrown as EstimatorRetryExhaustedError).attempts).toBe(1);
    expect((thrown as EstimatorRetryExhaustedError).cause).toBe(error);
    expect(sleep).not.toHaveBeenCalled();
    expect(inner.estimateCalls).toHaveLength(1);
  });

  test("counts the attempt whose retry-after time exceeds the cap when it happens after a wait", async () => {
    const delays: number[] = [];
    const secondError = retryableTransportError(60000);
    const inner = createScriptedEstimator({
      estimate: [
        { error: retryableTransportError() },
        { error: secondError },
      ],
    });
    const estimator = wrap(inner, { sleep: recordingSleep(delays) });

    const thrown = await estimator
      .estimate(estimateRequest)
      .catch((caught: unknown) => caught);

    expect(thrown).toBeInstanceOf(EstimatorRetryExhaustedError);
    expect((thrown as EstimatorRetryExhaustedError).attempts).toBe(2);
    expect((thrown as EstimatorRetryExhaustedError).cause).toBe(
      secondError,
    );
    expect(delays).toEqual([1000]);
  });

  test("throws the exhausted error with the last failure as cause after using up the configured attempts", async () => {
    const delays: number[] = [];
    const thirdError = retryableTransportError();
    const inner = createScriptedEstimator({
      estimate: [
        { error: retryableTransportError() },
        { error: retryableTransportError() },
        { error: thirdError },
      ],
    });
    const estimator = wrap(inner, { sleep: recordingSleep(delays) });

    const thrown = await estimator
      .estimate(estimateRequest)
      .catch((caught: unknown) => caught);

    expect(thrown).toBeInstanceOf(EstimatorRetryExhaustedError);
    expect((thrown as EstimatorRetryExhaustedError).attempts).toBe(3);
    expect((thrown as EstimatorRetryExhaustedError).cause).toBe(
      thirdError,
    );
    expect((thrown as EstimatorRetryExhaustedError).retryable).toBe(
      false,
    );
    expect(delays).toEqual([1000, 2000]);
  });

  test("exhausts on the first failure when only one attempt is allowed", async () => {
    const error = retryableTransportError();
    const inner = createScriptedEstimator({
      estimate: [{ error }],
    });
    const sleep = vi.fn(recordingSleep([]));
    const estimator = wrap(inner, {
      maxAttempts: 1,
      delaysMs: [],
      sleep,
    });

    const thrown = await estimator
      .estimate(estimateRequest)
      .catch((caught: unknown) => caught);

    expect(thrown).toBeInstanceOf(EstimatorRetryExhaustedError);
    expect((thrown as EstimatorRetryExhaustedError).attempts).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("throws the abort reason when the signal aborts while waiting, and calls the inner estimator no further", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const inner = createScriptedEstimator({
      estimate: [
        { error: retryableTransportError() },
        { value: { probability: 0.9 } },
      ],
    });
    const sleep = async (): Promise<void> => {
      controller.abort(reason);
    };
    const estimator = wrap(inner, { sleep });

    const thrown = await estimator
      .estimate(estimateRequest, { signal: controller.signal })
      .catch((caught: unknown) => caught);

    expect(thrown).toBe(reason);
    expect(inner.estimateCalls).toHaveLength(1);
  });

  test("throws the abort reason when the wait itself rejects on abort, without wrapping it as exhausted", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const inner = createScriptedEstimator({
      estimate: [{ error: retryableTransportError() }],
    });
    let waiting: () => void = () => {};
    const startedWaiting = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const sleep = (_ms: number, signal?: AbortSignal): Promise<void> =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(signal.reason);
        });
        waiting();
      });
    const estimator = wrap(inner, { sleep });

    const resultPromise = estimator.estimate(estimateRequest, {
      signal: controller.signal,
    });
    await startedWaiting;
    controller.abort(reason);
    const thrown = await resultPromise.catch(
      (caught: unknown) => caught,
    );

    expect(thrown).toBe(reason);
    expect(thrown).not.toBeInstanceOf(EstimatorRetryExhaustedError);
    expect(inner.estimateCalls).toHaveLength(1);
  });

  test("waits for real when no sleep function is given, and stops at once on abort", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const inner: Estimator = {
      model: "fake-model",
      limits: { minLabels: 1, maxLabels: 7, maxLevels: 4 },
      estimate: async () => {
        setTimeout(() => controller.abort(reason), 10);
        throw retryableTransportError();
      },
      classify: async () => {
        throw new Error("not scripted for this test");
      },
      score: async () => {
        throw new Error("not scripted for this test");
      },
    };
    const estimator = wrap(inner, {
      delaysMs: [60000, 60000],
      sleep: undefined,
    });

    const thrown = await estimator
      .estimate(estimateRequest, { signal: controller.signal })
      .catch((caught: unknown) => caught);

    expect(thrown).toBe(reason);
  }, 1000);

  test("waits for real when no sleep function is given, then succeeds on retry", async () => {
    const inner = createScriptedEstimator({
      estimate: [
        { error: retryableTransportError() },
        { value: { probability: 0.6 } },
      ],
    });
    const estimator = wrap(inner, {
      delaysMs: [20, 20],
      sleep: undefined,
    });

    await expect(estimator.estimate(estimateRequest)).resolves.toEqual({
      probability: 0.6,
    });
  });

  test.each([
    [{ maxAttempts: 0, delaysMs: [1000, 2000], maxDelayMs: 10000 }],
    [{ maxAttempts: 1.5, delaysMs: [1000, 2000], maxDelayMs: 10000 }],
    [{ maxAttempts: 3, delaysMs: [1000], maxDelayMs: 10000 }],
    [{ maxAttempts: 3, delaysMs: [-1, 2000], maxDelayMs: 10000 }],
    [
      {
        maxAttempts: 3,
        delaysMs: [Number.NaN, 2000],
        maxDelayMs: 10000,
      },
    ],
    [{ maxAttempts: 3, delaysMs: [1000, 2000], maxDelayMs: -1 }],
    [
      {
        maxAttempts: 3,
        delaysMs: [1000, 2000],
        maxDelayMs: Number.POSITIVE_INFINITY,
      },
    ],
  ])(
    "rejects invalid construction options with a RangeError: %o",
    (invalid) => {
      const inner = createScriptedEstimator({});

      expect(() =>
        createRetryingEstimator({ estimator: inner, ...invalid }),
      ).toThrow(RangeError);
    },
  );

  test("accepts delaysMs longer than the number of retries needed", () => {
    const inner = createScriptedEstimator({});

    expect(() =>
      createRetryingEstimator({
        estimator: inner,
        maxAttempts: 3,
        delaysMs: [1000, 2000, 4000],
        maxDelayMs: 10000,
      }),
    ).not.toThrow();
  });
});

describe("retrying a Jev Estimator", () => {
  test("ends in both texts with the status once and the body only in message", async () => {
    const jev = createJevEstimator({
      apiKey: "key",
      fetch: async () => new Response("upstream busy", { status: 503 }),
    });
    const estimator = createRetryingEstimator({
      estimator: jev,
      maxAttempts: 2,
      delaysMs: [0],
      maxDelayMs: 0,
    });

    const error = await estimator
      .estimate({ subject: "T", question: "Q" })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorRetryExhaustedError);
    expect((error as EstimatorRetryExhaustedError).message).toBe(
      "Estimator retries exhausted (attempts: 2): Jev request failed: 503: upstream busy",
    );
    expect(
      (error as EstimatorRetryExhaustedError).messageWithoutServiceText,
    ).toBe(
      "Estimator retries exhausted (attempts: 2): Jev request failed: 503: (text from the service left out)",
    );
  });
});
