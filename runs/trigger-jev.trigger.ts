// 書き方は packages/runner/agent-guide.md を見てください。
import { createJevEstimator } from "@mg/core";
import { createEstimatorTrigger } from "@mg/trigger";

const apiKey = process.env.TYPESAFE_API_KEY;
if (apiKey === undefined)
  throw new Error("TYPESAFE_API_KEY is not set");

const question =
  "Is the user wondering about something, or reminded of " +
  "something they need to do?";

export const trigger = createEstimatorTrigger({
  estimator: createJevEstimator({ apiKey }),
  question,
  threshold: 0.7,
});
