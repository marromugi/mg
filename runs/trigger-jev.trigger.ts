// 書き方は packages/runner/agent-guide.md を見てください。
import { createSampleJevEstimator } from "./jev-estimator.ts";
import { triggerNoteCases } from "./trigger-notes.ts";

const apiKey = process.env.TYPESAFE_API_KEY;
if (apiKey === undefined)
  throw new Error("TYPESAFE_API_KEY is not set");

export const { trigger } = triggerNoteCases(
  createSampleJevEstimator({ apiKey }),
);
