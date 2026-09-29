import type {
  DialogueWording,
  WorkEnding,
  WorkStatus,
} from "@mg/dialogue";
import type { Exchange } from "@mg/turn";

export const stopCheckMs = 2000;
export const exchangeCount = 3;
export const requestLimit = 500;

export const triggerThreshold = 0.7;

export const synthesizerVoice = "Kore";
export const synthesizerLanguage = "ja-JP";

export { bashReadOnlyPolicy as workerPolicy } from "./bash-policy.ts";

export const triggerQuestion =
  "直近のやり取りで、作業を頼まれていますか。";

export const judgeWording = {
  stop: {
    question: "作業を止めてほしいと言っていますか。",
    stop: "止めてと言った",
    continue: "それ以外",
  },
  redirect: {
    question: "話の向きが変わりましたか。",
    switch: "別のことを頼んだ",
    continue: "それ以外",
  },
  report: {
    question: "いま結果を話してよいですか。",
    speak: "話してよい",
    defer: "まだ話さない",
  },
};

export const exchangesText = (exchanges: Exchange[]): string =>
  exchanges
    .flatMap((exchange) => [
      `person: ${exchange.utterance}`,
      `talker: ${exchange.reply}`,
    ])
    .join("\n");

const stateLabel: Record<WorkStatus["state"], string> = {
  idle: "待機中",
  running: "実行中",
  held: "一時停止中",
};

const reasonLabel = {
  stop: "完了",
  "max-turns": "ターン数の上限で未完了",
  length: "長さの上限で未完了",
  "wrapped-up": "途中で切り上げ",
} as const;

const resultText = (ending: WorkEnding): string =>
  ending.kind === "failed"
    ? `失敗しました。理由: ${ending.reason}`
    : `${reasonLabel[ending.reason]}。最後の返答: ${ending.text}`;

const statusBlock = (status: WorkStatus): string => {
  const lines = [`作業の状態: ${stateLabel[status.state]}`];
  if (status.request !== null) {
    const cut =
      status.request.omitted > 0
        ? `（あと ${status.request.omitted} 文字は省略）`
        : "";
    lines.push(`依頼: ${status.request.text}${cut}`);
  }
  if (status.tools.length > 0) {
    lines.push("最近のツールの使用:");
    for (const tool of status.tools) {
      lines.push(
        `- ${tool.name}(${tool.arguments}) → ${tool.result ?? "実行中"}`,
      );
    }
  }
  if (status.latest !== null) {
    lines.push(`直前の作業: ${resultText(status.latest)}`);
  }
  return lines.join("\n");
};

export const wording: DialogueWording = {
  message: (status, utterance) =>
    `${statusBlock(status)}\n\n相手の発言: ${utterance}`,
  report: (status) =>
    `${statusBlock(status)}\n\n作業の結果を、いま相手に伝えてください。`,
  request: (exchanges) =>
    `次のやり取りで頼まれた作業をしてください。\n\n${exchangesText(exchanges)}`,
  result: resultText,
  notices: {
    judgment:
      "うまく判断できませんでした。作業は止めたまま、次の発言を待ちます。",
    transcription:
      "聞き取れませんでした。作業は止めたままです。もう一度お願いします。",
    talker: "うまく返事ができませんでした。作業の状態はそのままです。",
  },
};
