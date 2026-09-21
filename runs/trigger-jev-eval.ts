import { term } from "@mg/term";
import type { TextTriggerInput } from "@mg/trigger";
import type { LabelledInput, MeasuredRow } from "./trigger-measure.ts";
import { measureTrigger, summarize } from "./trigger-measure.ts";
import { trigger } from "./trigger-jev.trigger.ts";

const note = (text: string): TextTriggerInput => ({
  kind: "note",
  text,
});

const fitted: LabelledInput[] = [
  { expected: true, input: note("そういえば明日何かあったっけ") },
  {
    expected: true,
    input: note("来週のミーティングの資料、まだ作ってない"),
  },
  { expected: true, input: note("このエラー、前にも見た気がするな") },
  {
    expected: true,
    input: note("東京から大阪って新幹線でいくらだっけ"),
  },
  { expected: true, input: note("田中さんに返信するの忘れてた") },
  { expected: false, input: note("今日はいい天気だな") },
  { expected: false, input: note("眠い") },
  { expected: false, input: note("コーヒーうまい") },
  { expected: false, input: note("疲れたー、今日はもう終わり") },
  { expected: false, input: note("このアニメ最高だった") },
];

const heldOut: LabelledInput[] = [
  { expected: true, input: note("牛乳切らしてたかも") },
  { expected: true, input: note("確定申告っていつまでだっけ") },
  {
    expected: true,
    input: note("あのライブラリの名前なんだっけ、日付を扱うやつ"),
  },
  {
    expected: true,
    input: note("来月の出張のホテル、まだ取ってないな"),
  },
  {
    expected: true,
    input: note("この英語の言い回し、合ってるのかな"),
  },
  { expected: false, input: note("今日のランチおいしかった") },
  { expected: false, input: note("雨やだなあ") },
  { expected: false, input: note("ねこかわいい") },
  { expected: false, input: note("電車混んでた") },
  { expected: false, input: note("やっと金曜日だ") },
];

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

const [fittedRows, heldOutRows] = await Promise.all([
  measureTrigger(trigger, fitted),
  measureTrigger(trigger, heldOut),
]);

const fittedPassed = printGroup("fitted", fittedRows);
const heldOutPassed = printGroup("held-out", heldOutRows);

if (!fittedPassed || !heldOutPassed) process.exitCode = 1;
