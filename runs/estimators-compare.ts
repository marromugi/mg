// 書き方は packages/runner/agent-guide.md を見てください。
import type { Estimator } from "@mg/core";
import { term } from "@mg/term";
import { createSampleClefEstimator } from "./clef-estimator.ts";
import { judgeCases } from "./judge-cases.ts";
import { createSampleJevEstimator } from "./jev-estimator.ts";
import { describeError } from "./show-run.ts";
import type { TimedEstimator } from "./timed-estimator.ts";
import {
  createTimedEstimator,
  timingSummary,
} from "./timed-estimator.ts";
import { measureTrigger } from "./trigger-measure.ts";
import { triggerNoteCases } from "./trigger-notes.ts";

const required = [
  "TYPESAFE_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
] as const;

const missing = required.filter(
  (name) => (process.env[name] ?? "") === "",
);
if (missing.length > 0) {
  throw new Error(`${missing.join(", ")} is not set`);
}

const apiKey = process.env.TYPESAFE_API_KEY ?? "";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "";

type Subject = {
  name: string;
  estimator: Estimator;
  timed: TimedEstimator[];
};

// Each subject times the requests it sends, below its retries.
const subject = (
  name: string,
  create: (inside: (estimator: Estimator) => Estimator) => Estimator,
): Subject => {
  const timed: TimedEstimator[] = [];
  const estimator = create((inner) => {
    const wrapped = createTimedEstimator(inner);
    timed.push(wrapped);
    return wrapped;
  });
  return { name, estimator, timed };
};

const subjects: Subject[] = [
  subject("jev-latest", (inside) =>
    createSampleJevEstimator({ apiKey, inside }),
  ),
  subject("clef", (inside) =>
    createSampleClefEstimator({
      accountId,
      apiToken,
      model: "clef",
      inside,
    }),
  ),
  subject("clef-flash", (inside) =>
    createSampleClefEstimator({
      accountId,
      apiToken,
      model: "clef-flash",
      inside,
    }),
  ),
];

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

const attempt = async <T>(
  run: () => Promise<T>,
): Promise<Attempt<T>> => {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
};

type NoteRow = {
  text: string;
  expected: boolean;
  outcome: Attempt<{ fired: boolean; probability: number }>;
};

type JudgeRow = {
  judge: string;
  summary: string;
  outcome: Attempt<string>;
};

type Result = {
  name: string;
  notes: NoteRow[];
  judges: JudgeRow[];
  durationsMs: number[];
};

// Cases go one after another within a model, so each request is timed
// without the others competing; the models run side by side.
const runSubject = async (target: Subject): Promise<Result> => {
  const { trigger, fitted, heldOut } = triggerNoteCases(
    target.estimator,
  );

  const notes: NoteRow[] = [];
  for (const labelled of [...fitted, ...heldOut]) {
    const outcome = await attempt(async () => {
      const [row] = await measureTrigger(trigger, [labelled]);
      return { fired: row.fired, probability: row.probability };
    });
    notes.push({
      text: labelled.input.text,
      expected: labelled.expected,
      outcome,
    });
  }

  const judges: JudgeRow[] = [];
  for (const line of judgeCases(target.estimator)) {
    judges.push({
      judge: line.judge,
      summary: line.summary,
      outcome: await attempt(() => line.run({})),
    });
  }

  return {
    name: target.name,
    notes,
    judges,
    durationsMs: target.timed.flatMap((timed) => timed.durationsMs),
  };
};

const results = await Promise.all(subjects.map(runSubject));

const differs = (index: number): boolean => {
  const answers = new Set<string>();
  for (const result of results) {
    const outcome = result.judges[index].outcome;
    if (outcome.ok) answers.add(outcome.value);
  }
  return answers.size > 1;
};

let failed = false;

for (const result of results) {
  console.log(
    term.paint("strong", `${term.mark.strong} ${result.name}`),
  );

  const right = result.notes.filter(
    (row) => row.outcome.ok && row.outcome.value.fired === row.expected,
  ).length;
  console.log(`  trigger notes: ${right}/${result.notes.length} right`);

  for (const row of result.notes) {
    if (!row.outcome.ok) {
      failed = true;
      console.error(
        term.paint(
          "error",
          `  ${term.mark.error} no answer ${row.text}: ${row.outcome.error}`,
        ),
      );
      continue;
    }
    const match = row.outcome.value.fired === row.expected;
    console.log(
      term.paint(
        match ? "success" : "error",
        `  ${match ? term.mark.success : term.mark.error} ` +
          `${match ? "right" : "wrong"} ${row.text} ` +
          `expected: ${row.expected} fired: ${row.outcome.value.fired} ` +
          `probability: ${row.outcome.value.probability.toFixed(2)}`,
      ),
    );
  }

  console.log("  turn judges:");
  result.judges.forEach((row, index) => {
    if (!row.outcome.ok) {
      failed = true;
      console.error(
        term.paint(
          "error",
          `  ${term.mark.error} no answer ${row.judge}: ${row.summary}: ${row.outcome.error}`,
        ),
      );
      return;
    }
    const mark = differs(index) ? " (models differ)" : "";
    console.log(
      term.paint(
        mark === "" ? "success" : "warn",
        `  ${row.judge}: ${row.summary} -> ${row.outcome.value}${mark}`,
      ),
    );
  });

  if (result.durationsMs.length === 0) {
    console.log("  time: no request was sent");
  } else {
    const timing = timingSummary(result.durationsMs);
    console.log(
      `  time: median ${timing.medianMs} ms, slowest ${timing.slowestMs} ms ` +
        `(${timing.requests} requests)`,
    );
  }
}

if (failed) process.exitCode = 1;
