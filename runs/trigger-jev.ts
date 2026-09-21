// 書き方は packages/runner/agent-guide.md を見てください。
import type { Message } from "@mg/core";
import { createJevEstimator, createOpenRouterProvider } from "@mg/core";
import { defineRun, runOnTrigger } from "@mg/runner";
import { term } from "@mg/term";
import type { TextTriggerInput } from "@mg/trigger";
import { createEstimatorTrigger } from "@mg/trigger";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const jevApiKey = process.env.TYPESAFE_API_KEY;
if (jevApiKey === undefined)
  throw new Error("TYPESAFE_API_KEY is not set");

const prompt =
  "The input is something the user muttered to themselves, not a " +
  "request addressed to an assistant. A run should start only when " +
  "an assistant could concretely help with what they said, such as " +
  "answering a question, looking something up, or preparing " +
  "something they will need.";

const trigger = createEstimatorTrigger({
  estimator: createJevEstimator({ apiKey: jevApiKey }),
  prompt,
  threshold: 0.7,
});

const runConfig = defineRun({
  name: "trigger-jev",
  provider: createOpenRouterProvider({ apiKey }),
  harness: { kind: "loop", model: "openai/gpt-4o-mini", maxTurns: 10 },
  trace: { jsonlPath: "./trace.jsonl" },
});

const toMessages = (input: TextTriggerInput): Message[] => [
  {
    role: "user",
    content: `The user just muttered to themselves: "${input.text}"`,
  },
];

const inputs: TextTriggerInput[] = [
  { kind: "note", text: "そういえば明日何かあったっけ" },
  { kind: "note", text: "今日はいい天気だな" },
  { kind: "note", text: "来週のミーティングの資料、まだ作ってない" },
];

for (const input of inputs) {
  const outcome = await runOnTrigger(
    {
      trigger,
      run: runConfig,
      toMessages,
      trace: { jsonlPath: "./trigger-trace.jsonl" },
    },
    input,
  );

  const tone = outcome.decision.fired ? "success" : "muted";
  const mark = outcome.decision.fired
    ? term.mark.success
    : term.mark.muted;

  console.log(
    term.paint("strong", `${term.mark.strong} ${input.text}`),
  );
  console.log(
    term.paint(tone, `  ${mark} fired: ${outcome.decision.fired}`),
  );
  console.log(term.paint(tone, `  reason: ${outcome.decision.reason}`));
  console.log(
    term.paint(tone, `  run started: ${outcome.fired ? "yes" : "no"}`),
  );
}
