// 書き方は packages/runner/agent-guide.md を見てください。
import { createSampleJevEstimator } from "./jev-estimator.ts";
import { runJevMeasure } from "./persona-jev.measure-run.ts";

const apiKey = process.env.TYPESAFE_API_KEY;
if (apiKey === undefined)
  throw new Error("TYPESAFE_API_KEY is not set");

const result = await runJevMeasure(
  createSampleJevEstimator({ apiKey }),
);

for (const part of [result.recall, result.keep, result.persona]) {
  for (const row of part.rows) console.log(JSON.stringify(row));
  console.log(JSON.stringify(part.summary));
}

if (!result.passed) process.exitCode = 1;
