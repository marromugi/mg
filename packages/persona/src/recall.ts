import type { Estimator, EstimatorSubject } from "@mg/core";
import type { MemoryStore } from "@mg/memory";
import { isAbortError } from "./abort.js";
import { RecallError } from "./errors.js";
import { composeInstruction } from "./instruction.js";
import type { RecallRead } from "./read.js";
import { withRecallSpan } from "./trace.js";
import type { PersonaContext, Recall, RecallRequest } from "./types.js";

export type RecallHeadings = {
  about: string;
  earlier: string;
};

export type RecallOptions = {
  id: string;
  store: MemoryStore;
  estimator: Estimator;
  question: string;
  noneDescription: string;
  ratio: number;
  headings: RecallHeadings;
};

const isEmpty = (value: string): boolean => value.trim().length === 0;

const validateRequest = (
  request: RecallRequest<EstimatorSubject>,
): void => {
  const seen = new Set<string>();

  for (const counterpart of request.counterparts) {
    if (isEmpty(counterpart.id)) {
      throw new RangeError("A counterpart id must not be empty.");
    }
    if (isEmpty(counterpart.name)) {
      throw new RangeError("A counterpart name must not be empty.");
    }
    if (seen.has(counterpart.id)) {
      throw new RangeError(
        `Counterpart id "${counterpart.id}" is duplicated.`,
      );
    }
    seen.add(counterpart.id);
  }

  if (isEmpty(request.conversation)) {
    throw new RangeError("The conversation id must not be empty.");
  }
};

export const createRecall = (
  options: RecallOptions,
): ((
  request: RecallRequest<EstimatorSubject>,
  context?: PersonaContext,
) => Promise<Recall<RecallRead>>) => {
  const {
    id,
    store,
    estimator,
    question,
    noneDescription,
    ratio,
    headings,
  } = options;

  return async (request, context) => {
    validateRequest(request);

    return withRecallSpan(context, id, estimator, async () => {
      const view = await store.read(id, {
        counterparts: request.counterparts.map(
          (counterpart) => counterpart.id,
        ),
        conversation: request.conversation,
      });

      const maxCandidates = estimator.limits.maxLabels - 1;
      const candidateItems = view.items.slice(0, maxCandidates);

      let selectedIds: string[] = [];
      let probabilities: Record<string, number> | undefined;

      if (candidateItems.length > 0) {
        const labels = Object.fromEntries([
          ...candidateItems.map((item, index): [string, string] => [
            String(index),
            item.text,
          ]),
          ["none", noneDescription] as [string, string],
        ]);

        let classification;
        try {
          classification = await estimator.classify(
            { subject: request.input, question, labels },
            { signal: context?.signal },
          );
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          throw new RecallError(
            "Estimator.classify failed during recall.",
            { cause: error },
          );
        }

        probabilities = classification.probabilities;

        if (classification.label !== "none") {
          const threshold =
            classification.probabilities[classification.label] * ratio;
          selectedIds = candidateItems
            .filter(
              (_, index) =>
                (classification.probabilities[String(index)] ?? 0) >=
                threshold,
            )
            .map((item) => item.id);
        }
      }

      const read: RecallRead = {
        counterparts: request.counterparts,
        conversation: request.conversation,
        persona: view.persona,
        ...(view.summary !== undefined
          ? { summary: view.summary }
          : {}),
        items: view.items,
        candidates: candidateItems.map((item) => item.id),
        selected: selectedIds,
      };

      const instruction = composeInstruction(read, headings);

      return {
        recall: { instruction, read },
        candidates: candidateItems.length,
        selected: selectedIds,
        probabilities,
      };
    });
  };
};
