import { ATTR, setSpanAttributes } from "@mg/trace";
import type { TextTriggerInput, Trigger } from "@mg/trigger";
import { withTriggerSpan } from "@mg/trigger";
import { describe, expect, test } from "vitest";
import type { LabelledInput } from "./trigger-measure.ts";
import { measureTrigger, summarize } from "./trigger-measure.ts";

const note = (text: string): TextTriggerInput => ({
  kind: "note",
  text,
});

const createFakeTrigger = (
  probabilities: Readonly<Record<string, number>>,
  fires: Readonly<Record<string, boolean>>,
): Trigger<TextTriggerInput> => ({
  decide: (input, context) =>
    withTriggerSpan(context, {}, async (span) => {
      setSpanAttributes(span, {
        [ATTR.triggerProbability]: probabilities[input.text],
      });
      return { fired: fires[input.text], reason: "x" };
    }),
});

describe("measureTrigger", () => {
  test("returns the expectation, decision, and probability for each input", async () => {
    const trigger = createFakeTrigger(
      { a: 0.9, b: 0.1 },
      { a: true, b: false },
    );
    const inputs: LabelledInput[] = [
      { expected: true, input: note("a") },
      { expected: false, input: note("b") },
    ];

    const rows = await measureTrigger(trigger, inputs);

    expect(rows).toEqual([
      { expected: true, text: "a", fired: true, probability: 0.9 },
      { expected: false, text: "b", fired: false, probability: 0.1 },
    ]);
  });

  test("starts every judgement before any of them finishes, and returns rows in input order", async () => {
    const calls: string[] = [];
    const finish = new Map<string, () => void>();

    const trigger: Trigger<TextTriggerInput> = {
      decide: (input, context) =>
        withTriggerSpan(context, {}, (span) => {
          calls.push(input.text);
          return new Promise((resolve) => {
            finish.set(input.text, () => {
              setSpanAttributes(span, {
                [ATTR.triggerProbability]: 0.5,
              });
              resolve({ fired: true, reason: "x" });
            });
          });
        }),
    };

    const inputs: LabelledInput[] = [
      { expected: true, input: note("a") },
      { expected: true, input: note("b") },
      { expected: true, input: note("c") },
    ];

    const resultPromise = measureTrigger(trigger, inputs);

    expect(calls).toHaveLength(3);

    const finishOne = (text: string): void => {
      const resolve = finish.get(text);
      if (resolve === undefined) {
        throw new Error(`no pending judgement for: ${text}`);
      }
      resolve();
    };

    finishOne("c");
    finishOne("a");
    finishOne("b");

    const rows = await resultPromise;
    expect(rows.map((row) => row.text)).toEqual(["a", "b", "c"]);
  });

  test("throws when the trigger's span carries no probability", async () => {
    const trigger: Trigger<TextTriggerInput> = {
      decide: (input, context) =>
        withTriggerSpan(context, {}, async () => ({
          fired: true,
          reason: "x",
        })),
    };
    const inputs: LabelledInput[] = [
      { expected: true, input: note("a") },
    ];

    await expect(measureTrigger(trigger, inputs)).rejects.toThrow(
      "no probability was recorded for: a",
    );
  });

  test("rethrows the error the trigger throws", async () => {
    const error = new Error("judge broke");
    const trigger: Trigger<TextTriggerInput> = {
      decide: async () => {
        throw error;
      },
    };
    const inputs: LabelledInput[] = [
      { expected: true, input: note("a") },
    ];

    await expect(measureTrigger(trigger, inputs)).rejects.toBe(error);
  });
});

describe("summarize", () => {
  test("reports zero misses and false fires when the trigger separates the two sides cleanly", () => {
    const rows = [
      { expected: true, text: "a", fired: true, probability: 0.9 },
      { expected: true, text: "b", fired: true, probability: 0.8 },
      { expected: false, text: "c", fired: false, probability: 0.2 },
      { expected: false, text: "d", fired: false, probability: 0.1 },
    ];

    const summary = summarize(rows);

    expect(summary.missed).toBe(0);
    expect(summary.falseFires).toBe(0);
    expect(summary.minExpectedTrue).toBe(0.8);
    expect(summary.maxExpectedFalse).toBe(0.2);
    expect(summary.gap).toBeCloseTo(0.6, 10);
    expect(summary.passed).toBe(true);
  });

  test("counts misses and false fires and fails when the two sides overlap", () => {
    const rows = [
      { expected: true, text: "a", fired: true, probability: 0.9 },
      { expected: true, text: "b", fired: false, probability: 0.4 },
      { expected: false, text: "c", fired: true, probability: 0.75 },
      { expected: false, text: "d", fired: false, probability: 0.1 },
    ];

    const summary = summarize(rows);

    expect(summary.missed).toBe(1);
    expect(summary.falseFires).toBe(1);
    expect(summary.minExpectedTrue).toBe(0.4);
    expect(summary.maxExpectedFalse).toBe(0.75);
    expect(summary.gap).toBeCloseTo(-0.35, 10);
    expect(summary.passed).toBe(false);
  });

  test("throws when one of the two expected sides has no rows", () => {
    const onlyExpectedTrue = [
      { expected: true, text: "a", fired: true, probability: 0.9 },
    ];
    const onlyExpectedFalse = [
      { expected: false, text: "b", fired: false, probability: 0.1 },
    ];

    expect(() => summarize(onlyExpectedTrue)).toThrow(
      "both expected-true and expected-false inputs are needed",
    );
    expect(() => summarize(onlyExpectedFalse)).toThrow(
      "both expected-true and expected-false inputs are needed",
    );
  });
});
