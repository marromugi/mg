import type {
  Estimate,
  EstimateOptions,
  EstimateRequest,
  Estimator,
} from "@mg/core";
import { EstimatorResponseError } from "@mg/core";
import { ATTR, SPAN } from "@mg/trace";
import { buildSessionTree } from "@mg/trace/store";
import type { SessionTree } from "@mg/trace/store";
import { describe, expect, it, vi } from "vitest";
import { evaluate } from "./evaluate.js";
import { createEstimatorChecker } from "./estimator.js";
import { EstimatorCheckError } from "./errors.js";
import { transcribe } from "./transcript.js";
import type { EvalInput } from "./types.js";
import type { RunView } from "./view.js";

const makeView = (overrides: Partial<RunView> = {}): RunView => ({
  sessionId: "session-1",
  steps: [],
  llmSteps: [],
  toolSteps: [],
  gateSteps: [],
  subagentSteps: [],
  turnCount: 0,
  finalText: "the assistant said hello",
  usage: { inputTokens: 0, outputTokens: 0 },
  startTime: "2026-01-01T00:00:00.000Z",
  endTime: "2026-01-01T00:00:01.000Z",
  ...overrides,
});

const makeSession = (view: RunView): SessionTree => ({
  sessionId: view.sessionId,
  serviceName: "svc",
  startTime: view.startTime,
  endTime: view.endTime,
  traces: [],
});

const makeInput = (view: RunView): EvalInput => ({
  session: makeSession(view),
  view,
});

const createFakeEstimator = (
  estimate: (
    request: EstimateRequest,
    options?: EstimateOptions,
  ) => Promise<Estimate>,
): Estimator => ({
  model: "m",
  limits: { maxLabels: 255, maxLevels: 10 },
  estimate,
  classify: () => Promise.reject(new Error("not used")),
  score: () => Promise.reject(new Error("not used")),
});

describe("createEstimatorChecker", () => {
  it("passes at the default threshold when the probability meets it, and fails just below it", async () => {
    const checker = createEstimatorChecker({
      estimator: createFakeEstimator(async () => ({
        probability: 0.9,
      })),
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });

    const passing = await check.evaluate(makeInput(makeView()));

    expect(passing.passed).toBe(true);
    expect(passing.threshold).toBe(0.9);

    const belowChecker = createEstimatorChecker({
      estimator: createFakeEstimator(async () => ({
        probability: 0.89,
      })),
    });
    const belowCheck = belowChecker({
      name: "polite",
      question: "Is it polite?",
    });

    const failing = await belowCheck.evaluate(makeInput(makeView()));

    expect(failing.passed).toBe(false);
  });

  it("passes at a custom threshold when the probability meets it exactly", async () => {
    const checker = createEstimatorChecker({
      estimator: createFakeEstimator(async () => ({
        probability: 0.5,
      })),
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
      threshold: 0.5,
    });

    const outcome = await check.evaluate(makeInput(makeView()));

    expect(outcome.passed).toBe(true);
  });

  it("returns passed, score and threshold, and a reason matching the fixed sentence exactly", async () => {
    const checker = createEstimatorChecker({
      estimator: createFakeEstimator(async () => ({
        probability: 0.93,
      })),
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
      threshold: 0.9,
    });

    const outcome = await check.evaluate(makeInput(makeView()));

    expect(outcome.passed).toBe(true);
    expect(outcome.score).toBe(0.93);
    expect(outcome.threshold).toBe(0.9);
    expect(outcome.reason).toBe(
      "Estimator answered 0.930; threshold 0.9",
    );
  });

  it("sends the check question and the default transcript of the run as the request", async () => {
    const calls: EstimateRequest[] = [];
    const checker = createEstimatorChecker({
      estimator: createFakeEstimator(async (request) => {
        calls.push(request);
        return { probability: 0.95 };
      }),
    });
    const view = makeView();
    const check = checker({
      name: "polite",
      question: "Was the agent polite?",
    });

    await check.evaluate(makeInput(view));

    expect(calls[0].question).toBe("Was the agent polite?");
    expect(calls[0].subject).toBe(transcribe(view));
  });

  it("sends the text from a custom transcribe function instead of the default", async () => {
    const calls: EstimateRequest[] = [];
    const checker = createEstimatorChecker({
      estimator: createFakeEstimator(async (request) => {
        calls.push(request);
        return { probability: 0.95 };
      }),
      transcribe: () => "custom",
    });
    const check = checker({
      name: "polite",
      question: "Was the agent polite?",
    });

    await check.evaluate(makeInput(makeView()));

    expect(calls[0].subject).toBe("custom");
  });

  it("rejects an empty name or an empty question at creation time", () => {
    const checker = createEstimatorChecker({
      estimator: createFakeEstimator(async () => ({
        probability: 0.9,
      })),
    });

    expect(() =>
      checker({ name: "", question: "Is it polite?" }),
    ).toThrow(RangeError);
    expect(() => checker({ name: "polite", question: "" })).toThrow(
      RangeError,
    );
  });

  it("rejects a threshold outside 0 to 1, and accepts 0 and 1", () => {
    const checker = createEstimatorChecker({
      estimator: createFakeEstimator(async () => ({
        probability: 0.9,
      })),
    });

    expect(() =>
      checker({
        name: "polite",
        question: "Is it polite?",
        threshold: 1.1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      checker({
        name: "polite",
        question: "Is it polite?",
        threshold: -0.1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      checker({
        name: "polite",
        question: "Is it polite?",
        threshold: Number.NaN,
      }),
    ).toThrow(RangeError);
    expect(() =>
      checker({
        name: "polite",
        question: "Is it polite?",
        threshold: 0,
      }),
    ).not.toThrow();
    expect(() =>
      checker({
        name: "polite",
        question: "Is it polite?",
        threshold: 1,
      }),
    ).not.toThrow();
  });

  it("rejects with the Estimator error's message after the check's own words, keeping the Estimator error as cause", async () => {
    const original = new EstimatorResponseError(
      "Jev response failed validation",
    );
    const checker = createEstimatorChecker({
      estimator: createFakeEstimator(async () => {
        throw original;
      }),
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });

    const error = await check
      .evaluate(makeInput(makeView()))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(EstimatorCheckError);
    expect((error as EstimatorCheckError).message).toBe(
      "Estimator request failed: Jev response failed validation",
    );
    expect((error as EstimatorCheckError).cause).toBe(original);
  });

  it("includes the Estimator error's own cause text in the message", async () => {
    const checker = createEstimatorChecker({
      estimator: createFakeEstimator(async () => {
        throw new EstimatorResponseError("Jev response is not JSON", {
          cause: new SyntaxError("Unexpected token '<'"),
        });
      }),
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });

    const error = await check
      .evaluate(makeInput(makeView()))
      .catch((thrown: unknown) => thrown);

    expect((error as EstimatorCheckError).message).toBe(
      "Estimator request failed: Jev response is not JSON: Unexpected token '<'",
    );
  });

  it("gives an error result with the same message when the checks run over a session", async () => {
    const checker = createEstimatorChecker({
      estimator: createFakeEstimator(async () => {
        throw new EstimatorResponseError(
          "Jev response failed validation",
        );
      }),
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });

    const session = buildSessionTree([
      {
        sessionId: "session-1",
        serviceName: "svc",
        traceId: "trace-1",
        parentSpanId: undefined,
        spanId: "run",
        name: SPAN.run,
        startTime: "2026-01-01T00:00:00.000Z",
        endTime: "2026-01-01T00:00:01.000Z",
        attributes: { [ATTR.op]: "run" },
        events: [],
        status: { code: 0 },
      },
    ]);
    if (session === undefined) throw new Error("session not built");

    const verdict = await evaluate(session, [check]);

    expect(verdict.checks[0]).toMatchObject({
      name: "polite",
      status: "error",
      message:
        "Estimator request failed: Jev response failed validation",
    });
  });

  it("rejects without calling the estimator when the signal is already aborted, throwing the abort reason", async () => {
    const estimate = vi.fn(async () => ({ probability: 0.9 }));
    const checker = createEstimatorChecker({
      estimator: createFakeEstimator(estimate),
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });
    const controller = new AbortController();
    const reason = new Error("cancelled");
    controller.abort(reason);

    const error = await check
      .evaluate(makeInput(makeView()), { signal: controller.signal })
      .catch((thrown: unknown) => thrown);

    expect(error).toBe(reason);
    expect(estimate).not.toHaveBeenCalled();
  });

  it("passes the same signal through to the estimator", async () => {
    let receivedSignal: AbortSignal | undefined;
    const checker = createEstimatorChecker({
      estimator: createFakeEstimator(async (_request, options) => {
        receivedSignal = options?.signal;
        return { probability: 0.9 };
      }),
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });
    const controller = new AbortController();

    await check.evaluate(makeInput(makeView()), {
      signal: controller.signal,
    });

    expect(receivedSignal).toBe(controller.signal);
  });

  it("lets an AbortError thrown by the estimator through unwrapped", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const checker = createEstimatorChecker({
      estimator: createFakeEstimator(async () => {
        throw abortError;
      }),
    });
    const check = checker({
      name: "polite",
      question: "Is it polite?",
    });

    const error = await check
      .evaluate(makeInput(makeView()))
      .catch((thrown: unknown) => thrown);

    expect(error).toBe(abortError);
  });
});
