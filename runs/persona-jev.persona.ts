// 書き方は packages/runner/agent-guide.md を見てください。
import { createJevEstimator, createOpenRouterProvider } from "@mg/core";
import type { EstimatorSubject } from "@mg/core";
import type { MemoryStore } from "@mg/memory";
import type { Persona, RecallRead } from "@mg/persona";
import { createLlmExtractor, createPersona } from "@mg/persona";

const typesafeApiKey = process.env.TYPESAFE_API_KEY;
if (typesafeApiKey === undefined)
  throw new Error("TYPESAFE_API_KEY is not set");

const openRouterApiKey = process.env.OPENROUTER_API_KEY;
if (openRouterApiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const recallQuestion =
  "Which of these memories about the counterparts matters for " +
  "replying to the current message?";
const noneDescription = "None of these memories matters here.";
const recallRatio = 0.5;
const headings = { about: "## About", earlier: "## Earlier" };

const keepQuestion =
  "Is this something worth remembering about the counterpart for " +
  "future conversations?";
const keepThreshold = 0.6;

const personaQuestion =
  "Should the agent's persona change to the proposed text, given " +
  "what happened in this conversation?";
const personaThreshold = 0.8;

const extractionInstruction =
  "Summarize the conversation, list anything worth remembering " +
  "about each counterpart, and propose a persona change only when " +
  "the conversation revealed something lasting about who the " +
  "agent is.";

export const createJevPersona = (options: {
  store: MemoryStore;
}): Persona<EstimatorSubject, RecallRead> =>
  createPersona({
    id: "jev",
    store: options.store,
    estimator: createJevEstimator({ apiKey: typesafeApiKey }),
    recall: {
      question: recallQuestion,
      noneDescription,
      ratio: recallRatio,
      headings,
    },
    extractor: createLlmExtractor({
      provider: createOpenRouterProvider({ apiKey: openRouterApiKey }),
      model: "openai/gpt-4o-mini",
      instruction: extractionInstruction,
    }),
    keep: { question: keepQuestion, threshold: keepThreshold },
    persona: { question: personaQuestion, threshold: personaThreshold },
    forgetting: { missLimit: 3, itemsPerCounterpart: 20 },
  });
