// 書き方は packages/runner/agent-guide.md を見てください。
import { createOpenRouterProvider } from "@mg/core";
import type { EstimatorSubject } from "@mg/core";
import type { MemoryStore } from "@mg/memory";
import type { Persona, RecallRead } from "@mg/persona";
import { createSampleJevEstimator } from "./jev-estimator.ts";
import { buildJevPersona } from "./persona-jev.build.ts";

const typesafeApiKey = process.env.TYPESAFE_API_KEY;
if (typesafeApiKey === undefined)
  throw new Error("TYPESAFE_API_KEY is not set");

const openRouterApiKey = process.env.OPENROUTER_API_KEY;
if (openRouterApiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

export const createJevPersona = (options: {
  store: MemoryStore;
}): Persona<EstimatorSubject, RecallRead> =>
  buildJevPersona({
    store: options.store,
    estimator: createSampleJevEstimator({ apiKey: typesafeApiKey }),
    extractorProvider: createOpenRouterProvider({
      apiKey: openRouterApiKey,
    }),
  });
