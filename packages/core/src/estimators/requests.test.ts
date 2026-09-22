import { describe, expect, test } from "vitest";
import {
  assertClassifyRequest,
  assertScoreRequest,
} from "./requests.js";
import type {
  ClassifyRequest,
  EstimatorLimits,
  ScoreRequest,
} from "./types.js";

const limits: EstimatorLimits = { maxLabels: 255, maxLevels: 10 };

describe("assertClassifyRequest", () => {
  test("rejects a request with no labels", () => {
    const request: ClassifyRequest = {
      subject: "T",
      question: "Q",
      labels: {},
    };

    expect(() => assertClassifyRequest(request, limits)).toThrow(
      RangeError,
    );
    expect(() => assertClassifyRequest(request, limits)).toThrow(
      /^labels has 0 entries; at least 1 is required$/,
    );
  });

  test("rejects a request whose labels exceed the declared limit, but accepts one at the limit", () => {
    const tightLimits: EstimatorLimits = {
      maxLabels: 2,
      maxLevels: 10,
    };
    const tooMany: ClassifyRequest = {
      subject: "T",
      question: "Q",
      labels: { a: "x", b: "y", c: "z" },
    };

    expect(() => assertClassifyRequest(tooMany, tightLimits)).toThrow(
      RangeError,
    );
    expect(() => assertClassifyRequest(tooMany, tightLimits)).toThrow(
      /^labels has 3 entries; the estimator accepts at most 2$/,
    );

    const atLimit: ClassifyRequest = {
      subject: "T",
      question: "Q",
      labels: { a: "x", b: "y" },
    };

    expect(assertClassifyRequest(atLimit, tightLimits)).toBeUndefined();
  });
});

describe("assertScoreRequest", () => {
  test("rejects a request whose levels exceed the declared limit, but accepts one at the limit", () => {
    const request: ScoreRequest = {
      subject: "T",
      question: "Q",
      levels: ["a", "b", "c"],
    };

    const tightLimits: EstimatorLimits = {
      maxLabels: 255,
      maxLevels: 2,
    };

    expect(() => assertScoreRequest(request, tightLimits)).toThrow(
      RangeError,
    );
    expect(() => assertScoreRequest(request, tightLimits)).toThrow(
      /^levels has 3 entries; the estimator accepts at most 2$/,
    );

    const looseLimits: EstimatorLimits = {
      maxLabels: 255,
      maxLevels: 3,
    };

    expect(assertScoreRequest(request, looseLimits)).toBeUndefined();
  });
});
