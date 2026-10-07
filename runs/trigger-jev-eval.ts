import { term } from "@mg/term";
import type { MeasuredRow } from "./trigger-measure.ts";
import { measureTrigger, summarize } from "./trigger-measure.ts";
import { createSampleJevEstimator } from "./jev-estimator.ts";
import { triggerNoteCases } from "./trigger-notes.ts";

const printRow = (row: MeasuredRow): void => {
  const match = row.expected === row.fired;
  const missed = row.expected && !row.fired;
  const tone = match ? "success" : missed ? "error" : "warn";
  const mark = match
    ? term.mark.success
    : missed
      ? term.mark.error
      : term.mark.warn;
  const label = match ? "match" : missed ? "miss" : "false fire";

  console.log(
    term.paint(
      tone,
      `  ${mark} ${label} ${row.text} expected: ${row.expected} ` +
        `fired: ${row.fired} probability: ${row.probability.toFixed(2)}`,
    ),
  );
};

const printGroup = (name: string, rows: MeasuredRow[]): boolean => {
  console.log(term.paint("strong", `${term.mark.strong} ${name}`));

  for (const row of rows) printRow(row);

  const summary = summarize(rows);
  const expectedTrueCount = rows.filter((row) => row.expected).length;
  const expectedFalseCount = rows.filter((row) => !row.expected).length;

  console.log(`  missed: ${summary.missed}/${expectedTrueCount}`);
  console.log(
    `  false fires: ${summary.falseFires}/${expectedFalseCount}`,
  );
  console.log(
    `  min expected-true: ${summary.minExpectedTrue.toFixed(2)}`,
  );
  console.log(
    `  max expected-false: ${summary.maxExpectedFalse.toFixed(2)}`,
  );
  console.log(`  gap: ${summary.gap.toFixed(2)}`);

  return summary.passed;
};

const apiKey = process.env.TYPESAFE_API_KEY;
if (apiKey === undefined)
  throw new Error("TYPESAFE_API_KEY is not set");

const { trigger, fitted, heldOut } = triggerNoteCases(
  createSampleJevEstimator({ apiKey }),
);

const [fittedRows, heldOutRows] = await Promise.all([
  measureTrigger(trigger, fitted),
  measureTrigger(trigger, heldOut),
]);

const fittedPassed = printGroup("fitted", fittedRows);
const heldOutPassed = printGroup("held-out", heldOutRows);

if (!fittedPassed || !heldOutPassed) process.exitCode = 1;
