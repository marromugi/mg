import type { Estimator } from "@mg/core";
import {
  noopSpan,
  type TraceAttributes,
  type TraceSpan,
} from "@mg/harness";
import { ATTR, endSpan, setSpanAttributes, SPAN } from "@mg/trace";
import type { RecallRead } from "./read.js";
import type {
  PersonaContext,
  Recall,
  RememberOutcome,
} from "./types.js";

export type RecallSpanResult = {
  recall: Recall<RecallRead>;
  candidates: number;
  selected: readonly string[];
  probabilities?: Record<string, number>;
};

export const withRecallSpan = async (
  context: PersonaContext | undefined,
  personaId: string,
  estimator: Estimator,
  body: (span: TraceSpan) => Promise<RecallSpanResult>,
): Promise<Recall<RecallRead>> => {
  if (context?.trace === undefined) {
    const { recall } = await body(noopSpan);
    return recall;
  }

  let span: TraceSpan;
  try {
    span = context.trace.startSpan(SPAN.recall, {
      [ATTR.op]: "recall",
      [ATTR.personaId]: personaId,
      [ATTR.recallModel]: estimator.model,
    });
  } catch {
    span = noopSpan;
  }

  try {
    const { recall, candidates, selected, probabilities } =
      await body(span);
    const attributes: TraceAttributes = {
      [ATTR.recallCandidates]: candidates,
      [ATTR.recallSelected]: JSON.stringify(selected),
      ...(probabilities !== undefined
        ? { [ATTR.recallProbabilities]: JSON.stringify(probabilities) }
        : {}),
    };
    setSpanAttributes(span, attributes);
    endSpan(span);
    return recall;
  } catch (error) {
    endSpan(span, error);
    throw error;
  }
};

export type ReflectionSpanResult = {
  outcome: RememberOutcome<RecallRead>;
  candidates: number;
  kept: number;
  personaChanged: boolean;
  forgotten: readonly string[];
};

export const withReflectionSpan = async (
  context: PersonaContext | undefined,
  personaId: string,
  estimator: Estimator,
  body: (span: TraceSpan) => Promise<ReflectionSpanResult>,
): Promise<RememberOutcome<RecallRead>> => {
  if (context?.trace === undefined) {
    const { outcome } = await body(noopSpan);
    return outcome;
  }

  let span: TraceSpan;
  try {
    span = context.trace.startSpan(SPAN.reflection, {
      [ATTR.op]: "reflection",
      [ATTR.personaId]: personaId,
      [ATTR.reflectionModel]: estimator.model,
    });
  } catch {
    span = noopSpan;
  }

  const { outcome, candidates, kept, personaChanged, forgotten } =
    await body(span);

  if (outcome.updated) {
    setSpanAttributes(span, {
      [ATTR.reflectionCandidates]: candidates,
      [ATTR.reflectionKept]: kept,
      [ATTR.reflectionPersonaChanged]: personaChanged,
      [ATTR.reflectionForgotten]: JSON.stringify(forgotten),
    });
    endSpan(span);
  } else {
    endSpan(span, outcome.error);
  }

  return outcome;
};
