import type {
  Estimator,
  EstimatorSubject,
  ToolForcingProvider,
} from "@mg/core";
import type { MemoryStore } from "@mg/memory";
import type { Persona, RecallRead } from "@mg/persona";
import { createLlmExtractor, createPersona } from "@mg/persona";
import { keep, personaChange, recall } from "./persona-jev.values.ts";

const headings = { about: "## About", earlier: "## Earlier" };

const extractionInstruction =
  "Summarize the conversation, list anything worth remembering " +
  "about each counterpart, and propose a persona change only when " +
  "the conversation revealed something lasting about who the " +
  "agent is.";

export const buildJevPersona = (options: {
  store: MemoryStore;
  estimator: Estimator;
  extractorProvider: ToolForcingProvider;
}): Persona<EstimatorSubject, RecallRead> =>
  createPersona({
    id: "jev",
    store: options.store,
    estimator: options.estimator,
    recall: { ...recall, headings },
    extractor: createLlmExtractor({
      provider: options.extractorProvider,
      model: "deepseek/deepseek-v4-flash",
      instruction: extractionInstruction,
    }),
    keep,
    persona: personaChange,
    forgetting: { missLimit: 3, itemsPerCounterpart: 20 },
  });
