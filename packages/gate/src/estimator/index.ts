import { isEstimatorError, type Estimator } from "@mg/core";
import { ATTR, setSpanAttributes } from "@mg/trace";
import { GateError } from "../errors.js";
import { toStateText } from "../state.js";
import { withGateSpan } from "../trace.js";
import type {
  Gate,
  GateContext,
  GateRequest,
  Verdict,
} from "../types.js";

export type EstimatorGateOptions = {
  estimator: Estimator;
  question: string;
  threshold?: number;
};

const DEFAULT_THRESHOLD = 0.5;

const ALLOWED_REASON = "The estimator judged this action acceptable.";
const DENIED_REASON = "The estimator judged this action unacceptable.";

export const createEstimatorGate = (
  options: EstimatorGateOptions,
): Gate => {
  const { estimator, question } = options;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  if (!(
    Number.isFinite(threshold) &&
    threshold >= 0 &&
    threshold <= 1
  )) {
    throw new RangeError("threshold must be between 0 and 1");
  }

  if (question.trim() === "") {
    throw new RangeError("question must not be empty");
  }

  return {
    async judge(
      request: GateRequest,
      context?: GateContext,
    ): Promise<Verdict> {
      context?.signal?.throwIfAborted();

      return withGateSpan(
        context,
        request,
        { [ATTR.gateModel]: estimator.model },
        async (span) => {
          let probability: number;
          try {
            ({ probability } = await estimator.estimate(
              { subject: toStateText(request), question },
              { signal: context?.signal },
            ));
          } catch (error) {
            if (isEstimatorError(error)) {
              throw new GateError("Gate judgement failed", {
                cause: error,
              });
            }
            throw error;
          }

          setSpanAttributes(span, {
            [ATTR.gateProbability]: probability,
          });

          const allowed = probability >= threshold;
          const reason = allowed ? ALLOWED_REASON : DENIED_REASON;

          return { allowed, reason };
        },
      );
    },
  };
};
