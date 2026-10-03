import type {
  DialogueWording,
  WorkEnding,
  WorkStatus,
} from "@mg/dialogue";
import type { Exchange } from "@mg/turn";
import type { AudioFormat } from "@mg/voice";

export const STOP_CHECK_MS = 2000;
export const EXCHANGE_COUNT = 3;
export const REQUEST_LIMIT = 500;
export const LANGUAGES = ["ja-JP"] as const;
export const TRIGGER_THRESHOLD = 0.7;

export { bashReadOnlyQuestion as workerQuestion } from "./bash-policy.ts";

// The format the Gemini Live transcriber accepts.
export const LISTENER_FORMAT: AudioFormat = {
  encoding: "pcm-s16le",
  sampleRate: 16000,
  channels: 1,
};

// The loudness at which sound counts as speech, in dB relative to full
// scale, and how long it must hold, in ms, to start and to end an
// utterance. An utterance carries the LISTENER_LEAD_MS before it.
export const LISTENER_LEVEL_DB = -40;
export const LISTENER_START_MS = 100;
export const LISTENER_END_MS = 800;
export const LISTENER_LEAD_MS = 300;

// Tool activity in the status block: how many calls, and how many
// characters of each call's arguments and result.
const TOOL_COUNT = 5;
const TOOL_TEXT_LIMIT = 200;

export const talkerInstruction = [
  "あなたは、人と声で話しています。",
  "作業は、別のワーカーが行います。",
  "各メッセージの先頭に「作業の状況」があります。",
  "そこに、ワーカーがいま何をしているかが書かれています。",
  "あなたは作業をしません。",
  "作業ができない、とも言いません。",
  "返事は、話し言葉で短く書きます。",
].join("\n");

export const exchangesText = (exchanges: Exchange[]): string =>
  exchanges
    .flatMap((exchange) => [
      `person: ${exchange.utterance}`,
      `talker: ${exchange.reply}`,
    ])
    .join("\n");

const clip = (text: string): string => {
  const characters = Array.from(text);
  return characters.length <= TOOL_TEXT_LIMIT
    ? text
    : `${characters.slice(0, TOOL_TEXT_LIMIT).join("")}…`;
};

const REASON_LABELS: Record<string, string> = {
  stop: "",
  "max-turns": "（ターンの上限で中断）",
  length: "（長さの上限で中断）",
  "wrapped-up": "（途中で打ち切り）",
};

export const resultText = (ending: WorkEnding): string => {
  if (ending.kind === "failed") return `失敗しました: ${ending.reason}`;
  const label = REASON_LABELS[ending.reason] ?? "";
  return label === "" ? ending.text : `${label}\n${ending.text}`;
};

const STATE_LABELS: Record<WorkStatus["state"], string> = {
  idle: "作業なし",
  running: "作業中",
  held: "一時停止中",
};

const statusBlock = (status: WorkStatus): string => {
  const lines = [
    "【作業の状況】",
    `状態: ${STATE_LABELS[status.state]}`,
  ];
  if (status.request !== null) {
    lines.push(`依頼: ${status.request.text}`);
    if (status.request.omitted > 0) {
      lines.push(
        `（依頼の続き ${status.request.omitted} 文字は省略しました）`,
      );
    }
  }
  const tools = status.tools.slice(-TOOL_COUNT);
  if (tools.length > 0) {
    lines.push("最近の作業:");
    for (const tool of tools) {
      const result =
        tool.result === null ? "実行中" : clip(tool.result);
      lines.push(`- ${tool.name} ${clip(tool.arguments)} → ${result}`);
    }
  }
  if (status.latest !== null) {
    lines.push(
      status.latest.kind === "ended" &&
        status.latest.reason === "wrapped-up"
        ? "前の作業は、途中で打ち切られました。"
        : `前の作業の結果:\n${resultText(status.latest)}`,
    );
  }
  return lines.join("\n");
};

export const wording: DialogueWording = {
  message: (status, utterance) =>
    `${statusBlock(status)}\n\n【人の発話】\n${utterance}`,
  report: (status) =>
    `${statusBlock(status)}\n\n【依頼】\n作業が終わりました。結果を人に短く伝えてください。`,
  request: (exchanges) =>
    `次の会話で頼まれた作業を行ってください。\n\n${exchangesText(exchanges)}`,
  result: resultText,
  notices: {
    judgment:
      "判断がうまくいきませんでした。作業は止めたままです。もう一度話してください。",
    transcription:
      "聞き取れませんでした。作業は止めたままです。もう一度話してください。",
    talker:
      "返事を作れませんでした。作業は止めたままです。もう一度話してください。",
  },
};

export const questions = {
  stop: {
    question:
      "話している人は、いま進んでいる作業を止めてほしい、または待ってほしいと言っていますか。",
    stop: "作業を止めてほしい、待ってほしいと言った",
    continue: "それ以外",
  },
  redirect: {
    question: "話の向きが変わり、別の作業を頼みましたか。",
    switch: "いまの作業をやめて、別のことを頼んだ",
    continue: "それ以外",
  },
  report: {
    question: "いま作業の結果を話してよいですか。",
    speak: "話してよい",
    defer: "まだ話さない",
  },
  trigger: "話している人は、何か作業をしてほしいと頼みましたか。",
} as const;

export const workNotRequestedLine = (position: number): string =>
  `item ${position}: work was not requested`;
