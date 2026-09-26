// 書き方は packages/runner/agent-guide.md を見てください。
import { createJevEstimator } from "@mg/core";
import { startRootSpan } from "@mg/trace";
import { createTraceSdk } from "@mg/trace/otel";
import type { JudgeContext, JudgeName } from "@mg/turn";
import {
  createEstimatorBackchannelJudge,
  createEstimatorOverlapJudge,
  createEstimatorRedirectJudge,
  createEstimatorReportJudge,
  createEstimatorStopJudge,
  createEstimatorWorkSpeechJudge,
  JudgeError,
} from "@mg/turn";
import { term } from "@mg/term";

const apiKey = process.env.TYPESAFE_API_KEY;
if (apiKey === undefined)
  throw new Error("TYPESAFE_API_KEY is not set");

const estimator = createJevEstimator({ apiKey });

const backchannelJudge = createEstimatorBackchannelJudge({
  estimator,
  question: "相づちを打ちますか。",
  phrases: [
    { text: "うん", when: "軽くうなずく" },
    { text: "なるほど", when: "納得を示す" },
  ],
  none: "相づちは要らない",
});

const workSpeechJudge = createEstimatorWorkSpeechJudge({
  estimator,
  question: "作業中に何か話しますか。",
  report: "進みを伝える",
  fills: [{ text: "少々お待ちください", when: "少し待たせている" }],
  silent: "話すことはない",
});

const stopJudge = createEstimatorStopJudge({
  estimator,
  question: "作業を止めてほしいと言っていますか。",
  stop: "止めてと言った",
  continue: "それ以外",
});

const redirectJudge = createEstimatorRedirectJudge({
  estimator,
  question: "話の向きが変わりましたか。",
  switch: "別のことを頼んだ",
  continue: "それ以外",
});

const reportJudge = createEstimatorReportJudge({
  estimator,
  question: "いま結果を話してよいですか。",
  speak: "話してよい",
  defer: "まだ話さない",
});

const overlapJudge = createEstimatorOverlapJudge({
  estimator,
  question: "新しい頼みは今の作業を置き換えますか。",
  replace: "置き換える",
  queue: "あとで別にやる",
});

type Line = {
  judge: JudgeName;
  summary: string;
  run: (context: JudgeContext) => Promise<string>;
};

const lines: Line[] = [
  {
    judge: "backchannel",
    summary: "うん、それで",
    run: async (context) => {
      const answer = await backchannelJudge.judge(
        { interim: "うん、それで" },
        context,
      );
      return answer.action === "backchannel"
        ? `backchannel "${answer.text}"`
        : answer.action;
    },
  },
  {
    judge: "backchannel",
    summary: "え、それって本当ですか",
    run: async (context) => {
      const answer = await backchannelJudge.judge(
        { interim: "え、それって本当ですか" },
        context,
      );
      return answer.action === "backchannel"
        ? `backchannel "${answer.text}"`
        : answer.action;
    },
  },
  {
    judge: "work-speech",
    summary: "検索中、経過 4 秒",
    run: async (context) => {
      const answer = await workSpeechJudge.judge(
        {
          tools: [
            { name: "search", arguments: '{"q":"天気"}', result: null },
          ],
          elapsedMs: 4000,
        },
        context,
      );
      return answer.action === "fill"
        ? `fill "${answer.text}"`
        : answer.action;
    },
  },
  {
    judge: "work-speech",
    summary: "検索完了、経過 1 秒",
    run: async (context) => {
      const answer = await workSpeechJudge.judge(
        {
          tools: [
            {
              name: "search",
              arguments: '{"q":"天気"}',
              result: "晴れ",
            },
          ],
          elapsedMs: 1000,
        },
        context,
      );
      return answer.action === "fill"
        ? `fill "${answer.text}"`
        : answer.action;
    },
  },
  {
    judge: "stop",
    summary: "止めて",
    run: (context) =>
      stopJudge
        .judge({ utterance: "止めて" }, context)
        .then((answer) => answer.action),
  },
  {
    judge: "stop",
    summary: "ありがとう",
    run: (context) =>
      stopJudge
        .judge({ utterance: "ありがとう" }, context)
        .then((answer) => answer.action),
  },
  {
    judge: "redirect",
    summary: "天気の話から株価に切り替え",
    run: (context) =>
      redirectJudge
        .judge(
          {
            exchanges: [
              { utterance: "天気を調べて", reply: "調べます" },
              { utterance: "東京の天気ね", reply: "東京ですね" },
              {
                utterance: "やっぱり株価を調べて",
                reply: "わかりました",
              },
            ],
            request: "天気を調べて",
          },
          context,
        )
        .then((answer) => answer.action),
  },
  {
    judge: "redirect",
    summary: "天気の話を続けている",
    run: (context) =>
      redirectJudge
        .judge(
          {
            exchanges: [
              { utterance: "天気を調べて", reply: "調べます" },
              { utterance: "東京の天気ね", reply: "東京ですね" },
            ],
            request: "天気を調べて",
          },
          context,
        )
        .then((answer) => answer.action),
  },
  {
    judge: "report",
    summary: "話し中、結果は東京は晴れ",
    run: (context) =>
      reportJudge
        .judge(
          {
            said: "天気を調べています。",
            result: "東京は晴れです。",
          },
          context,
        )
        .then((answer) => answer.action),
  },
  {
    judge: "report",
    summary: "話が途切れている、結果は東京は晴れ",
    run: (context) =>
      reportJudge
        .judge({ said: "", result: "東京は晴れです。" }, context)
        .then((answer) => answer.action),
  },
  {
    judge: "overlap",
    summary: "天気の作業中に株価を頼まれた",
    run: (context) =>
      overlapJudge
        .judge(
          { running: "天気を調べて", request: "株価も調べて" },
          context,
        )
        .then((answer) => answer.action),
  },
  {
    judge: "overlap",
    summary: "天気の作業中に別の日の天気を頼まれた",
    run: (context) =>
      overlapJudge
        .judge(
          { running: "天気を調べて", request: "明日の天気も調べて" },
          context,
        )
        .then((answer) => answer.action),
  },
];

const sdk = await createTraceSdk({ jsonlPath: "./turn-trace.jsonl" });
const root = startRootSpan(sdk.tracer, "judges-jev");

let failed = false;

for (const line of lines) {
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
      const cause =
        error.cause instanceof Error
          ? error.cause.message
          : String(error.cause);
      console.error(
        term.paint(
          "error",
          `${line.judge}: ${error.message} (cause: ${cause})`,
        ),
      );
    } else {
      throw error;
    }
  }
}

root.end();
await sdk.shutdown();

if (failed) process.exitCode = 1;
