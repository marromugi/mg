# @mg/trace

記録の口の実体と、共通の語彙を持つパッケージです。

ハーネスは、記録の相手を入力で受け取ります。
その相手の実体は、このパッケージが持ちます。

## 役割

trace の役割は 4 つです。

- 記録の口の実体と、語彙を持ちます。
- LLM の接続先を包み、呼び出しの記録を書きます。
- 道具の実行部品を包み、実行の記録を書きます。
- 記録を外へ運ぶ、組み立てと保存先を持ちます。
- 保存した記録を、木の形にして読み手へ返します。

### 三つの入口

入口は三つあります。
持ち物と依存を、表にまとめます。

| 入口              | 持つもの                           | 依存                                |
| ----------------- | ---------------------------------- | ----------------------------------- |
| `@mg/trace`       | 口の実体、語彙、包む部品           | OpenTelemetry の API、harness、core |
| `@mg/trace/otel`  | 組み立てと保存先                   | `@mg/trace`、OpenTelemetry の SDK   |
| `@mg/trace/store` | 記録と木の型、読み手の口、表の定義 | drizzle、libsql                     |

この入口は、OpenTelemetry の SDK を読み込みません。
保存先とは切り離して、記録の形だけを扱えます。

trace は、harness と core を使います。
harness は、trace を知りません。

### セッション

記録は、セッションという単位で束ねます。
セッション id は `createTraceSdk` を組み立てるときに決まります。

入力で渡せばその値を使い、渡さなければ新しく作ります。
同じ会話の続きは、同じ SDK を使い続けます。

セッション id は、資源の属性に入ります。
サービス名と合わせて、表にまとめます。

| 属性           | 意味            |
| -------------- | --------------- |
| `session.id`   | セッションの id |
| `service.name` | サービスの名前  |

### 読み手

保存先ごとに、記録を読む役目があります。
読み手の口は `TraceReader` です。
`@mg/trace/store` にあります。

読み手は、セッション一つ分の記録を木の形にして返します。
保存先が違っても、返る形は同じです。

| 読み手              | 対象                  |
| ------------------- | --------------------- |
| `JsonlTraceReader`  | JSONL のファイル      |
| `SqliteTraceReader` | SQLite のデータベース |

### 記録を書く場所

LLM の呼び出しの記録は、接続先を包む部品が書きます。
その部品は `traceProvider` です。

道具の実行の記録は、実行部品を包む部品が書きます。
その部品は `traceRunToolCall` です。

ハーネス自身は、自分の記録だけを書きます。
記録に失敗しても、ハーネスは止まりません。

### 語彙

記録に書く名前は、`mg.` で始まるものだけです。
期間の名前は、共通のものが 4 つあります。

| 定数           | 名前         | 意味                 |
| -------------- | ------------ | -------------------- |
| `SPAN.harness` | `mg.harness` | ハーネス全体の期間   |
| `SPAN.llm`     | `mg.llm`     | LLM の呼び出しの期間 |
| `SPAN.tool`    | `mg.tool`    | 道具の実行の期間     |
| `SPAN.run`     | `mg.run`     | 走った 1 回分の期間  |

ハーネス固有の期間は、`mg.<ハーネス名>.` で始めます。

属性の名前も、表にまとめます。

| 定数                     | 名前                         | 意味                                     |
| ------------------------ | ---------------------------- | ---------------------------------------- |
| `ATTR.op`                | `mg.op`                      | 期間の種類（harness / llm / tool / run） |
| `ATTR.harnessName`       | `mg.harness.name`            | ハーネスの名前                           |
| `ATTR.runName`           | `mg.run.name`                | 設定の名前                               |
| `ATTR.runCase`           | `mg.run.case`                | 件の ID                                  |
| `ATTR.llmModel`          | `mg.llm.model`               | 使ったモデルの名前                       |
| `ATTR.llmStream`         | `mg.llm.stream`              | 細切れで受け取ったか                     |
| `ATTR.llmFinishReason`   | `mg.llm.finish_reason`       | 終わった理由                             |
| `ATTR.llmInputTokens`    | `mg.llm.usage.input_tokens`  | 入力のトークン数                         |
| `ATTR.llmOutputTokens`   | `mg.llm.usage.output_tokens` | 出力のトークン数                         |
| `ATTR.llmInputMessages`  | `mg.llm.messages.input`      | 送った会話（JSON 文字列）                |
| `ATTR.llmOutputMessages` | `mg.llm.messages.output`     | 返った会話（JSON 文字列）                |
| `ATTR.toolName`          | `mg.tool.name`               | 道具の名前                               |
| `ATTR.toolCallId`        | `mg.tool.call_id`            | 呼び出しの ID                            |
| `ATTR.toolArguments`     | `mg.tool.arguments`          | 渡した引数（JSON 文字列）                |
| `ATTR.toolResult`        | `mg.tool.result`             | 実行の結果                               |

属性の値は、文字列と数値と真偽値だけです。
構造がある値は、JSON の文字列にして持たせます。

## やらないこと

trace が扱わないことをまとめます。

- 記録には `gen_ai.` の名前を書きません。
- `gen_ai.` の名前は、画面へ送る保存先の直前でだけ足します。
- 会話の中身を伏せる仕組みは作りません。
- 記録を見るための画面は作りません。
- OpenTelemetry Collector は使いません。

## 使い方

組み立てから記録の相手を作り、ハーネスに渡す例です。
SQLite に保存し、あとで画面から見られるようにします。

```ts
import { createTraceSdk } from "@mg/trace/otel";
import { startRootSpan } from "@mg/trace";
import { collect } from "@mg/harness";
import { createLoopHarness } from "@mg/harness-loop";

const sdk = await createTraceSdk({ sqlitePath: "./trace.db" });
const trace = startRootSpan(sdk.tracer, "run");

const harness = createLoopHarness({
  provider,
  model: "openai/gpt-4o-mini",
  maxTurns: 10,
});

const result = await collect(
  harness({ messages: [{ role: "user", content: "..." }], trace }),
);
trace.end();
await sdk.shutdown();
```

根の期間は、`end` で閉じないと書き出されません。
`sdk.shutdown()` は、たまった記録を書き出してから終わります。

保存した記録は、`@mg/trace-ui` の画面から見られます。
見る画面の起動の仕方は、そちらの README にあります。
