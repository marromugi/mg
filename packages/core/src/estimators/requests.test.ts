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

const limits: EstimatorLimits = {
  minLabels: 1,
  maxLabels: 255,
  maxLevels: 10,
};

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
      /^labels has 0 entries; the estimator accepts at least 1$/,
    );
  });

  test("rejects a request with fewer labels than the declared minimum, but accepts one at the minimum", () => {
    const twoMin: EstimatorLimits = {
      minLabels: 2,
      maxLabels: 255,
      maxLevels: 10,
    };
    const one: ClassifyRequest = {
      subject: "T",
      question: "Q",
      labels: { a: "x" },
    };

    expect(() => assertClassifyRequest(one, twoMin)).toThrow(
      /^labels has 1 entries; the estimator accepts at least 2$/,
    );
    expect(
      assertClassifyRequest(
        { ...one, labels: { a: "x", b: "y" } },
        twoMin,
      ),
    ).toBeUndefined();
  });

  test("rejects a request whose labels exceed the declared limit, but accepts one at the limit", () => {
    const tightLimits: EstimatorLimits = {
      minLabels: 1,
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
      minLabels: 1,
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
      minLabels: 1,
      maxLabels: 255,
      maxLevels: 3,
    };

    expect(assertScoreRequest(request, looseLimits)).toBeUndefined();
  });
});
