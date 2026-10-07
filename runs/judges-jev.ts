// 書き方は packages/runner/agent-guide.md を見てください。
import { startRootSpan } from "@mg/trace";
import { createTraceSdk } from "@mg/trace/otel";
import { JudgeError } from "@mg/turn";
import { term } from "@mg/term";
import { judgeCases } from "./judge-cases.ts";
import { createSampleJevEstimator } from "./jev-estimator.ts";
import { judgeFailureLine } from "./outcome-lines.ts";
import { outputPath } from "./outputs.ts";

const apiKey = process.env.TYPESAFE_API_KEY;
if (apiKey === undefined)
  throw new Error("TYPESAFE_API_KEY is not set");

const estimator = createSampleJevEstimator({ apiKey });

const cases = judgeCases(estimator);

const sdk = await createTraceSdk({
  jsonlPath: outputPath("turn-trace.jsonl"),
});
const root = startRootSpan(sdk.tracer, "judges-jev");

let failed = false;

try {
  for (const line of cases) {
    try {
      const result = await line.run({ trace: root });
      console.log(
        term.paint(
          "success",
          `${line.judge}: ${line.summary} -> ${result}`,
        ),
      );
    } catch (error) {
      failed = true;
      if (error instanceof JudgeError) {
        console.error(
          term.paint("error", judgeFailureLine(line.judge, error)),
        );
      } else {
        throw error;
      }
    }
  }
} finally {
  root.end();
  await sdk.shutdown();
}

if (failed) process.exitCode = 1;
