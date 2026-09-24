import type { Estimator } from "@mg/core";
import type {
  MemoryChange,
  MemoryStore,
  MissCounts,
  NewMemoryItem,
} from "@mg/memory";
import { checkExtraction } from "./contract.js";
import type { RecallRead } from "./read.js";
import { transcribe } from "./transcript.js";
import {
  type ReflectionSpanResult,
  withReflectionSpan,
} from "./trace.js";
import type {
  Extraction,
  Extractor,
  PersonaContext,
  RememberOutcome,
  RememberRequest,
} from "./types.js";

export type RememberOptions = {
  id: string;
  store: MemoryStore;
  estimator: Estimator;
  extractor: Extractor;
  keep: { question: string; threshold: number };
  persona: { question: string; threshold: number };
  forgetting: { missLimit: number; itemsPerCounterpart: number };
  now: () => number;
  newId: () => string;
};

type KeptItem = { counterpart: string; text: string };

const undecidedResult = (
  error: unknown,
  request: RememberRequest<RecallRead>,
): ReflectionSpanResult => ({
  outcome: { updated: false, reason: "undecided", error, request },
  candidates: 0,
  kept: 0,
  personaChanged: false,
  forgotten: [],
});

const forgottenIdsFor = (
  read: RecallRead,
  added: readonly NewMemoryItem[],
  missCounts: MissCounts,
  forgetting: { missLimit: number; itemsPerCounterpart: number },
): string[] => {
  const forgotten = new Set<string>();

  for (const [itemId, count] of Object.entries(missCounts)) {
    if (count >= forgetting.missLimit) {
      forgotten.add(itemId);
    }
  }

  const counterpartIds = new Set([
    ...read.items.map((item) => item.counterpart),
    ...added.map((item) => item.counterpart),
  ]);

  for (const counterpartId of counterpartIds) {
    const existing = read.items.filter(
      (item) => item.counterpart === counterpartId,
    );
    const newlyAdded = added
      .filter((item) => item.counterpart === counterpartId)
      .slice()
      .reverse();
    const ordered = [...newlyAdded, ...existing].map((item, index) => ({
      id: item.id,
      createdAt: item.createdAt,
      index,
    }));
    ordered.sort(
      (a, b) => b.createdAt - a.createdAt || a.index - b.index,
    );

    for (const item of ordered.slice(forgetting.itemsPerCounterpart)) {
      forgotten.add(item.id);
    }
  }

  return [...forgotten];
};

export const createRemember = (
  options: RememberOptions,
): ((
  request: RememberRequest<RecallRead>,
  context?: PersonaContext,
) => Promise<RememberOutcome<RecallRead>>) => {
  const {
    id,
    store,
    estimator,
    extractor,
    keep,
    persona,
    forgetting,
    now,
    newId,
  } = options;

  return async (request, context) =>
    withReflectionSpan(context, id, estimator, async (span) => {
      const { read, entry } = request;

      let extraction: Extraction;
      try {
        extraction = await extractor.extract(
          {
            counterparts: read.counterparts,
            entry,
            memory: {
              persona: read.persona.text,
              items: read.items.map((item) => ({
                counterpart: item.counterpart,
                text: item.text,
              })),
              ...(read.summary !== undefined
                ? { summary: read.summary.text }
                : {}),
            },
          },
          { signal: context?.signal, trace: span },
        );
      } catch (error) {
        return undecidedResult(error, request);
      }

      const contractError = checkExtraction(
        extraction,
        read.counterparts,
      );
      if (contractError !== undefined) {
        return undecidedResult(contractError, request);
      }

      const kept: KeptItem[] = [];
      for (const item of extraction.items) {
        try {
          const estimate = await estimator.estimate(
            {
              subject: {
                counterpart: item.counterpart,
                text: item.text,
              },
              question: keep.question,
            },
            { signal: context?.signal },
          );
          if (estimate.probability >= keep.threshold) {
            kept.push(item);
          }
        } catch (error) {
          return undecidedResult(error, request);
        }
      }

      let personaChanged = false;
      let newPersonaText: string | undefined;
      if (extraction.persona !== undefined) {
        newPersonaText = extraction.persona;
        try {
          const estimate = await estimator.estimate(
            {
              subject: {
                previous: read.persona.text,
                proposed: newPersonaText,
                conversation: transcribe(entry),
              },
              question: persona.question,
            },
            { signal: context?.signal },
          );
          personaChanged = estimate.probability >= persona.threshold;
        } catch (error) {
          return undecidedResult(error, request);
        }
      }

      const added: NewMemoryItem[] = [];
      for (const item of kept) {
        try {
          added.push({
            id: newId(),
            counterpart: item.counterpart,
            text: item.text,
            createdAt: now(),
          });
        } catch (error) {
          return undecidedResult(error, request);
        }
      }

      const misses = read.candidates.filter(
        (candidateId) => !read.selected.includes(candidateId),
      );

      const change: MemoryChange = {
        summary: {
          conversation: read.conversation,
          text: extraction.summary,
          expectedVersion: read.summary?.version ?? 0,
        },
        ...(personaChanged && newPersonaText !== undefined
          ? {
              persona: {
                text: newPersonaText,
                expectedVersion: read.persona.version,
              },
            }
          : {}),
        ...(added.length > 0 ? { add: added } : {}),
        hits: read.selected,
        misses,
      };

      let missCounts: MissCounts;
      try {
        missCounts = await store.write(id, change);
      } catch (error) {
        return {
          outcome: { updated: false, reason: "write-failed", error },
          candidates: extraction.items.length,
          kept: kept.length,
          personaChanged,
          forgotten: [],
        };
      }

      const addedIds = added.map((item) => item.id);
      const forgotten = forgottenIdsFor(
        read,
        added,
        missCounts,
        forgetting,
      );

      if (forgotten.length > 0) {
        try {
          await store.delete(id, forgotten);
        } catch (error) {
          return {
            outcome: {
              updated: false,
              reason: "forget-failed",
              error,
              added: addedIds,
              personaChanged,
              pending: forgotten,
            },
            candidates: extraction.items.length,
            kept: kept.length,
            personaChanged,
            forgotten,
          };
        }
      }

      return {
        outcome: {
          updated: true,
          added: addedIds,
          personaChanged,
          forgotten,
        },
        candidates: extraction.items.length,
        kept: kept.length,
        personaChanged,
        forgotten,
      };
    });
};
