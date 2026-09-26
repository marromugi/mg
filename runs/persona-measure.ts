import type { Estimator } from "@mg/core";
import { createMemoryStore } from "@mg/memory";
import { createRecall } from "@mg/persona";

const PERSONA_ID = "measure";
const CONVERSATION_ID = "measure";
const HEADINGS = { about: "About", earlier: "Earlier" };

export type RecallItem = {
  id: string;
  counterpart: string;
  text: string;
  createdAt: number;
};

export type RecallInput = {
  input: string;
  items: readonly RecallItem[];
  expected: readonly string[];
};

export type RecallMeasureOptions = {
  question: string;
  noneDescription: string;
  ratio: number;
};

export type RecallRow = {
  input: string;
  selected: string[];
  matched: boolean;
};

export type RecallSummary = { mismatched: number; passed: boolean };

export type KeepCandidate = {
  counterpart: string;
  text: string;
  expected: boolean;
};

export type KeepRow = KeepCandidate & {
  probability: number;
  kept: boolean;
  matched: boolean;
};

export type KeepMeasureOptions = {
  question: string;
  threshold: number;
};

export type PersonaScene = {
  previous: string;
  proposed: string;
  conversation: string;
  expected: boolean;
};

export type PersonaRow = PersonaScene & {
  probability: number;
  accepted: boolean;
  matched: boolean;
};

export type PersonaMeasureOptions = {
  question: string;
  threshold: number;
};

export type KeepSummary = {
  missed: number;
  falseKeeps: number;
  minExpectedTrue: number;
  maxExpectedFalse: number;
  gap: number;
  passed: boolean;
};

const measureRecallOne = async (
  estimator: Estimator,
  options: RecallMeasureOptions,
  labelled: RecallInput,
): Promise<RecallRow> => {
  const store = createMemoryStore();
  await store.create(PERSONA_ID, "persona");

  if (labelled.items.length > 0) {
    await store.write(PERSONA_ID, {
      add: labelled.items.map((item) => ({
        id: item.id,
        counterpart: item.counterpart,
        text: item.text,
        createdAt: item.createdAt,
      })),
    });
  }

  const counterparts = [
    ...new Set(labelled.items.map((item) => item.counterpart)),
  ].map((id) => ({ id, name: id }));

  const recall = createRecall({
    id: PERSONA_ID,
    store,
    estimator,
    question: options.question,
    noneDescription: options.noneDescription,
    ratio: options.ratio,
    headings: HEADINGS,
  });

  const { read } = await recall({
    counterparts,
    conversation: CONVERSATION_ID,
    input: labelled.input,
  });

  const matched =
    read.selected.length === labelled.expected.length &&
    read.selected.every((id) => labelled.expected.includes(id));

  return { input: labelled.input, selected: read.selected, matched };
};

export const measureRecall = (
  estimator: Estimator,
  options: RecallMeasureOptions,
  inputs: readonly RecallInput[],
): Promise<RecallRow[]> =>
  Promise.all(
    inputs.map((labelled) =>
      measureRecallOne(estimator, options, labelled),
    ),
  );

export const summarizeRecall = (
  rows: readonly RecallRow[],
): RecallSummary => {
  const mismatched = rows.filter((row) => !row.matched).length;
  return { mismatched, passed: mismatched === 0 };
};

const measureKeepOne = async (
  estimator: Estimator,
  options: KeepMeasureOptions,
  candidate: KeepCandidate,
): Promise<KeepRow> => {
  const estimate = await estimator.estimate({
    subject: {
      counterpart: candidate.counterpart,
      text: candidate.text,
    },
    question: options.question,
  });
  const kept = estimate.probability >= options.threshold;
  return {
    ...candidate,
    probability: estimate.probability,
    kept,
    matched: kept === candidate.expected,
  };
};

export const measureKeep = (
  estimator: Estimator,
  options: KeepMeasureOptions,
  candidates: readonly KeepCandidate[],
): Promise<KeepRow[]> =>
  Promise.all(
    candidates.map((candidate) =>
      measureKeepOne(estimator, options, candidate),
    ),
  );

const measurePersonaOne = async (
  estimator: Estimator,
  options: PersonaMeasureOptions,
  scene: PersonaScene,
): Promise<PersonaRow> => {
  const estimate = await estimator.estimate({
    subject: {
      previous: scene.previous,
      proposed: scene.proposed,
      conversation: scene.conversation,
    },
    question: options.question,
  });
  const accepted = estimate.probability >= options.threshold;
  return {
    ...scene,
    probability: estimate.probability,
    accepted,
    matched: accepted === scene.expected,
  };
};

export const measurePersona = (
  estimator: Estimator,
  options: PersonaMeasureOptions,
  scenes: readonly PersonaScene[],
): Promise<PersonaRow[]> =>
  Promise.all(
    scenes.map((scene) => measurePersonaOne(estimator, options, scene)),
  );

type DecidedRow = {
  expected: boolean;
  probability: number;
  decided: boolean;
};

const summarizeDecided = (rows: readonly DecidedRow[]): KeepSummary => {
  const expectedTrue = rows.filter((row) => row.expected);
  const expectedFalse = rows.filter((row) => !row.expected);

  if (expectedTrue.length === 0 || expectedFalse.length === 0) {
    throw new Error(
      "both expected-true and expected-false rows are needed",
    );
  }

  const missed = expectedTrue.filter((row) => !row.decided).length;
  const falseKeeps = expectedFalse.filter((row) => row.decided).length;
  const minExpectedTrue = Math.min(
    ...expectedTrue.map((row) => row.probability),
  );
  const maxExpectedFalse = Math.max(
    ...expectedFalse.map((row) => row.probability),
  );

  return {
    missed,
    falseKeeps,
    minExpectedTrue,
    maxExpectedFalse,
    gap: minExpectedTrue - maxExpectedFalse,
    passed: missed === 0 && falseKeeps === 0,
  };
};

export const summarizeKeep = (rows: readonly KeepRow[]): KeepSummary =>
  summarizeDecided(
    rows.map((row) => ({
      expected: row.expected,
      probability: row.probability,
      decided: row.kept,
    })),
  );

export const summarizePersona = (
  rows: readonly PersonaRow[],
): KeepSummary =>
  summarizeDecided(
    rows.map((row) => ({
      expected: row.expected,
      probability: row.probability,
      decided: row.accepted,
    })),
  );
