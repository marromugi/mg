import type { Estimator } from "@mg/core";
import type { TextTriggerInput, Trigger } from "@mg/trigger";
import { createEstimatorTrigger } from "@mg/trigger";
import type { LabelledInput } from "./trigger-measure.ts";

const question =
  "Is the user wondering about something, or reminded of " +
  "something they need to do?";

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

export type TriggerNoteCases = {
  trigger: Trigger<TextTriggerInput>;
  fitted: LabelledInput[];
  heldOut: LabelledInput[];
};

// The 20 labelled notes, and the trigger that judges them with the
// given estimator.
export const triggerNoteCases = (
  estimator: Estimator,
): TriggerNoteCases => ({
  trigger: createEstimatorTrigger({
    estimator,
    question,
    threshold: 0.7,
  }),
  fitted,
  heldOut,
});
