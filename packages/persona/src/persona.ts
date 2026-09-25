import type { Estimator, EstimatorSubject } from "@mg/core";
import type { MemoryStore } from "@mg/memory";
import { nanoid } from "nanoid";
import { createRecall, type RecallHeadings } from "./recall.js";
import type { RecallRead } from "./read.js";
import { createRemember } from "./remember.js";
import type { Extractor, Persona } from "./types.js";

export type PersonaOptions = {
  id: string;
  store: MemoryStore;
  estimator: Estimator;
  recall: {
    question: string;
    noneDescription: string;
    ratio: number;
    headings: RecallHeadings;
  };
  extractor: Extractor;
  keep: { question: string; threshold: number };
  persona: { question: string; threshold: number };
  forgetting: { missLimit: number; itemsPerCounterpart: number };
  now?: () => number;
  newId?: () => string;
};

const isEmpty = (value: string): boolean => value.trim().length === 0;

const isRatio = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1;

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 1;

const validateOptions = (options: PersonaOptions): void => {
  if (
    isEmpty(options.id) ||
    isEmpty(options.recall.question) ||
    isEmpty(options.recall.noneDescription) ||
    isEmpty(options.recall.headings.about) ||
    isEmpty(options.recall.headings.earlier) ||
    isEmpty(options.keep.question) ||
    isEmpty(options.persona.question)
  ) {
    throw new RangeError(
      "The persona id, a question, a description or a heading must not be empty.",
    );
  }

  if (
    !isRatio(options.recall.ratio) ||
    !isRatio(options.keep.threshold) ||
    !isRatio(options.persona.threshold)
  ) {
    throw new RangeError(
      "A ratio or a threshold must be a finite number between 0 and 1.",
    );
  }

  if (
    !isPositiveInteger(options.forgetting.missLimit) ||
    !isPositiveInteger(options.forgetting.itemsPerCounterpart)
  ) {
    throw new RangeError(
      "The miss limit and the items-per-counterpart limit must be integers of 1 or more.",
    );
  }

  const maxLabels = options.estimator.limits.maxLabels;
  if (!Number.isInteger(maxLabels) || maxLabels < 2) {
    throw new RangeError(
      "The estimator's limits.maxLabels must be an integer of 2 or more.",
    );
  }

  if (options.forgetting.itemsPerCounterpart > maxLabels - 1) {
    throw new RangeError(
      "The items-per-counterpart limit must not exceed limits.maxLabels minus 1.",
    );
  }
};

export const createPersona = (
  options: PersonaOptions,
): Persona<EstimatorSubject, RecallRead> => {
  validateOptions(options);

  const recall = createRecall({
    id: options.id,
    store: options.store,
    estimator: options.estimator,
    question: options.recall.question,
    noneDescription: options.recall.noneDescription,
    ratio: options.recall.ratio,
    headings: options.recall.headings,
  });

  const remember = createRemember({
    id: options.id,
    store: options.store,
    estimator: options.estimator,
    extractor: options.extractor,
    keep: options.keep,
    persona: options.persona,
    forgetting: options.forgetting,
    now: options.now ?? Date.now,
    newId: options.newId ?? nanoid,
  });

  return { id: options.id, recall, remember };
};
