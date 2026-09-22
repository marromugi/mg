import type {
  ClassifyRequest,
  EstimatorLimits,
  ScoreRequest,
} from "./types.js";

export const assertClassifyRequest = (
  request: ClassifyRequest,
  limits: EstimatorLimits,
): void => {
  const count = Object.keys(request.labels).length;

  if (count === 0) {
    throw new RangeError(
      "labels has 0 entries; at least 1 is required",
    );
  }

  if (count > limits.maxLabels) {
    throw new RangeError(
      `labels has ${count} entries; the estimator accepts at most ${limits.maxLabels}`,
    );
  }
};

export const assertScoreRequest = (
  request: ScoreRequest,
  limits: EstimatorLimits,
): void => {
  const count = request.levels.length;

  if (count > limits.maxLevels) {
    throw new RangeError(
      `levels has ${count} entries; the estimator accepts at most ${limits.maxLevels}`,
    );
  }
};
