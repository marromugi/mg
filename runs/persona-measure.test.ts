import type {
  Classification,
  Estimate,
  EstimateRequest,
  Estimator,
  Score,
} from "@mg/core";
import { describe, expect, test } from "vitest";
import type {
  KeepCandidate,
  PersonaScene,
  RecallInput,
  RecallItem,
} from "./persona-measure.ts";
import {
  measureKeep,
  measurePersona,
  measureRecall,
  summarizeKeep,
  summarizePersona,
  summarizeRecall,
} from "./persona-measure.ts";

const createFakeClassifyEstimator = (
  responses: readonly Classification[],
): Estimator => {
  let index = 0;
  return {
    model: "fake",
    limits: { maxLabels: 255, maxLevels: 10 },
    estimate: (): Promise<Estimate> =>
      Promise.reject(new Error("not used")),
    classify: (): Promise<Classification> => {
      const response = responses[index];
      index++;
      return Promise.resolve(response);
    },
    score: (): Promise<Score> => Promise.reject(new Error("not used")),
  };
};

const createFakeEstimateEstimator = (
  responses: readonly Estimate[],
): Estimator & { calls: EstimateRequest[] } => {
  const calls: EstimateRequest[] = [];
  return {
    calls,
    model: "fake",
    limits: { maxLabels: 255, maxLevels: 10 },
    estimate: (request: EstimateRequest): Promise<Estimate> => {
      calls.push(request);
      const response = responses[calls.length - 1];
      return Promise.resolve(response);
    },
    classify: (): Promise<Classification> =>
      Promise.reject(new Error("not used")),
    score: (): Promise<Score> => Promise.reject(new Error("not used")),
  };
};

const itemA: RecallItem = {
  id: "m1",
  counterpart: "alice",
  text: "likes cats",
  createdAt: 300,
};
const itemB: RecallItem = {
  id: "m2",
  counterpart: "alice",
  text: "lives in Kyoto",
  createdAt: 200,
};

const recallOptions = {
  question: "Which memories matter?",
  noneDescription: "None of these matters.",
  ratio: 0.5,
};

describe("measureRecall", () => {
  test("selects the items the classification points at, above the ratio of its top probability", async () => {
    const estimator = createFakeClassifyEstimator([
      { label: "0", probabilities: { "0": 0.8, "1": 0.1, none: 0.1 } },
      {
        label: "none",
        probabilities: { "0": 0.1, "1": 0.1, none: 0.8 },
      },
    ]);
    const inputs: RecallInput[] = [
      { input: "cats?", items: [itemA, itemB], expected: ["m1"] },
      { input: "rain?", items: [itemA, itemB], expected: [] },
    ];

    const rows = await measureRecall(estimator, recallOptions, inputs);

    expect(rows).toEqual([
      { input: "cats?", selected: ["m1"], matched: true },
      { input: "rain?", selected: [], matched: true },
    ]);
    expect(summarizeRecall(rows)).toEqual({
      mismatched: 0,
      passed: true,
    });
  });

  test("counts a row as mismatched when the selection is not the expected one", async () => {
    const estimator = createFakeClassifyEstimator([
      { label: "0", probabilities: { "0": 0.8, "1": 0.1, none: 0.1 } },
      { label: "0", probabilities: { "0": 0.5, "1": 0.4, none: 0.1 } },
    ]);
    const inputs: RecallInput[] = [
      { input: "cats?", items: [itemA, itemB], expected: ["m1"] },
      { input: "rain?", items: [itemA, itemB], expected: [] },
    ];

    const rows = await measureRecall(estimator, recallOptions, inputs);

    expect(rows).toEqual([
      { input: "cats?", selected: ["m1"], matched: true },
      { input: "rain?", selected: ["m1", "m2"], matched: false },
    ]);
    expect(summarizeRecall(rows)).toEqual({
      mismatched: 1,
      passed: false,
    });
  });
});

const keepQuestion = "Should this be remembered?";

describe("measureKeep", () => {
  test("keeps a candidate when its probability clears the threshold", async () => {
    const estimator = createFakeEstimateEstimator([
      { probability: 0.9 },
      { probability: 0.2 },
    ]);
    const candidates: KeepCandidate[] = [
      { counterpart: "alice", text: "has a dog", expected: true },
      { counterpart: "alice", text: "said hi", expected: false },
    ];

    const rows = await measureKeep(
      estimator,
      { question: keepQuestion, threshold: 0.6 },
      candidates,
    );

    expect(estimator.calls[0]).toEqual({
      subject: { counterpart: "alice", text: "has a dog" },
      question: keepQuestion,
    });
    expect(rows).toEqual([
      {
        counterpart: "alice",
        text: "has a dog",
        expected: true,
        probability: 0.9,
        kept: true,
        matched: true,
      },
      {
        counterpart: "alice",
        text: "said hi",
        expected: false,
        probability: 0.2,
        kept: false,
        matched: true,
      },
    ]);
    expect(summarizeKeep(rows)).toEqual({
      missed: 0,
      falseKeeps: 0,
      minExpectedTrue: 0.9,
      maxExpectedFalse: 0.2,
      gap: 0.7,
      passed: true,
    });
  });

  test("throws when every candidate is expected true or every one is expected false", () => {
    const onlyExpectedTrue = [
      {
        counterpart: "alice",
        text: "has a dog",
        expected: true,
        probability: 0.9,
        kept: true,
        matched: true,
      },
    ];

    expect(() => summarizeKeep(onlyExpectedTrue)).toThrow(
      "both expected-true and expected-false rows are needed",
    );
  });
});

const personaQuestion = "Should this change be accepted?";

describe("measurePersona", () => {
  test("accepts a persona change when its probability clears the threshold", async () => {
    const estimator = createFakeEstimateEstimator([
      { probability: 0.9 },
      { probability: 0.1 },
    ]);
    const scenes: PersonaScene[] = [
      {
        previous: "I am Jev.",
        proposed: "I am Jev, a dog person.",
        conversation: "[user]\nalice: I got a dog",
        expected: true,
      },
      {
        previous: "I am Jev.",
        proposed: "I am Bob.",
        conversation: "[user]\nhi",
        expected: false,
      },
    ];

    const rows = await measurePersona(
      estimator,
      { question: personaQuestion, threshold: 0.8 },
      scenes,
    );

    expect(estimator.calls[0]).toEqual({
      subject: {
        previous: "I am Jev.",
        proposed: "I am Jev, a dog person.",
        conversation: "[user]\nalice: I got a dog",
      },
      question: personaQuestion,
    });
    expect(rows).toEqual([
      {
        previous: "I am Jev.",
        proposed: "I am Jev, a dog person.",
        conversation: "[user]\nalice: I got a dog",
        expected: true,
        probability: 0.9,
        accepted: true,
        matched: true,
      },
      {
        previous: "I am Jev.",
        proposed: "I am Bob.",
        conversation: "[user]\nhi",
        expected: false,
        probability: 0.1,
        accepted: false,
        matched: true,
      },
    ]);
    expect(summarizePersona(rows)).toEqual({
      missed: 0,
      falseKeeps: 0,
      minExpectedTrue: 0.9,
      maxExpectedFalse: 0.1,
      gap: 0.8,
      passed: true,
    });
  });
});
