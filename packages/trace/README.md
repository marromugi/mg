# @mg/trace

トレースの実装と、共通の語彙を持つパッケージです。

ハーネスは、親スパンを入力で受け取ります。
そのスパンの実装は、このパッケージが持ちます。

## 役割

trace の役割は 4 つです。

- トレースの実装と、語彙を持ちます。
- LLM のプロバイダーをラップし、呼び出しの記録を書きます。
- ツールの実行関数をラップし、実行の記録を書きます。
- トレースを外へ運ぶ、SDK とエクスポーターを持ちます。
- 保存したトレースを、リーダーがツリーの形にして返します。

### 三つのエントリーポイント

エントリーポイントは三つあります。
持ち物と依存を、表にまとめます。

| エントリーポイント | 持つもの                                     | 依存                                |
| ------------------ | -------------------------------------------- | ----------------------------------- |
| `@mg/trace`        | トレースの実装、語彙、ラッパー               | OpenTelemetry の API、harness、core |
| `@mg/trace/otel`   | SDK とエクスポーター                         | `@mg/trace`、OpenTelemetry の SDK   |
| `@mg/trace/store`  | トレースとツリーの型、リーダーの型、表の定義 | drizzle、libsql                     |

このエントリーポイントは、OpenTelemetry の SDK を読み込みません。
エクスポーターとは切り離して、トレースの形だけを扱えます。

trace は、harness と core を使います。
harness は、trace を知りません。

### セッション

トレースは、セッションという単位で束ねます。
セッション id は `createTraceSdk` で SDK を作るときに決まります。

入力で渡せばその値を使い、渡さなければ新しく作ります。
同じ会話の続きは、同じ SDK を使い続けます。

1 つのセッションは、複数のトレースを持てます。
スパンの `startRoot` は、同じセッションに新しい根を作ります。
新しい根のスパンは、親を持ちません。
トレースの ID は、元のスパンと別になります。
セッションの ID は、元のスパンと同じです。

セッション id は、リソース属性に入ります。
サービス名と合わせて、表にまとめます。

| 属性           | 意味            |
| -------------- | --------------- |
| `session.id`   | セッションの id |
| `service.name` | サービスの名前  |

### リーダー

保存先ごとに、トレースを読む役目があります。
リーダーの型は `TraceReader` です。
`@mg/trace/store` にあります。

リーダーは、セッション一つ分のトレースをツリーの形にして返します。
保存先が違っても、返る形は同じです。

| リーダー            | 対象                  |
| ------------------- | --------------------- |
| `JsonlTraceReader`  | JSONL のファイル      |
| `SqliteTraceReader` | SQLite のデータベース |

### 記録を書く場所

LLM の呼び出しの記録は、プロバイダーのラッパーが書きます。
そのラッパーは `traceProvider` です。

ツールの実行の記録は、実行関数のラッパーが書きます。
そのラッパーは `traceRunToolCall` です。

ハーネス自身は、自分の記録だけを書きます。
記録に失敗しても、ハーネスは止まりません。

判定の記録は、`@mg/gate` が書きます。
親スパンを受け取ったときだけ、判定を `mg.gate` として書きます。

### 語彙

トレースに書く名前は、`mg.` で始まるものだけです。
スパンの名前は、共通のものが 6 つあります。

| 定数             | 名前           | 意味                   |
| ---------------- | -------------- | ---------------------- |
| `SPAN.harness`   | `mg.harness`   | ハーネス全体のスパン   |
| `SPAN.llm`       | `mg.llm`       | LLM の呼び出しのスパン |
| `SPAN.tool`      | `mg.tool`      | ツールの実行のスパン   |
| `SPAN.run`       | `mg.run`       | 1 回の実行のスパン     |
| `SPAN.gate`      | `mg.gate`      | 判定のスパン           |
| `SPAN.workspace` | `mg.workspace` | 作業場の開閉のスパン   |

ハーネス固有のスパンは、`mg.<ハーネス名>.` で始めます。

属性の名前も、表にまとめます。

| 定数                       | 名前                         | 意味                                                          |
| -------------------------- | ---------------------------- | ------------------------------------------------------------- |
| `ATTR.op`                  | `mg.op`                      | スパンの種類（harness / llm / tool / run / gate / workspace） |
| `ATTR.harnessName`         | `mg.harness.name`            | ハーネスの名前                                                |
| `ATTR.runName`             | `mg.run.name`                | 設定の名前                                                    |
| `ATTR.runCase`             | `mg.run.case`                | 件の ID                                                       |
| `ATTR.workspaceName`       | `mg.workspace.name`          | 作業場の名前                                                  |
| `ATTR.workspaceConnectors` | `mg.workspace.connectors`    | 接続方法の種類の並び（JSON 文字列）                           |
| `ATTR.workspaceTools`      | `mg.workspace.tools`         | 生まれた道具の名前の並び（JSON 文字列）                       |
| `ATTR.llmModel`            | `mg.llm.model`               | 使ったモデルの名前                                            |
| `ATTR.llmProvider`         | `mg.llm.provider`            | プロバイダーの名前（名前がなければ省く）                      |
| `ATTR.llmStream`           | `mg.llm.stream`              | ストリーミングで受け取ったか                                  |
| `ATTR.llmFinishReason`     | `mg.llm.finish_reason`       | 終わった理由                                                  |
| `ATTR.llmInputTokens`      | `mg.llm.usage.input_tokens`  | 入力のトークン数                                              |
| `ATTR.llmOutputTokens`     | `mg.llm.usage.output_tokens` | 出力のトークン数                                              |
| `ATTR.llmInputMessages`    | `mg.llm.messages.input`      | 送った会話（JSON 文字列）                                     |
| `ATTR.llmOutputMessages`   | `mg.llm.messages.output`     | 返った会話（JSON 文字列）                                     |
| `ATTR.toolName`            | `mg.tool.name`               | ツールの名前                                                  |
| `ATTR.toolCallId`          | `mg.tool.call_id`            | 呼び出しの ID                                                 |
| `ATTR.toolArguments`       | `mg.tool.arguments`          | 渡した引数（JSON 文字列）                                     |
| `ATTR.toolResult`          | `mg.tool.result`             | 実行の結果                                                    |
| `ATTR.gateKind`            | `mg.gate.kind`               | 判定した対象の種類                                            |
| `ATTR.gateDescription`     | `mg.gate.description`        | 判定した対象の説明文                                          |
| `ATTR.gateAllowed`         | `mg.gate.allowed`            | 判定の可否                                                    |
| `ATTR.gateReason`          | `mg.gate.reason`             | 判定の理由                                                    |
| `ATTR.gateModel`           | `mg.gate.model`              | 判定に使ったモデルの名前（LLM の実装だけ）                    |

属性の値は、文字列と数値と真偽値だけです。
構造がある値は、JSON の文字列にして持たせます。

## やらないこと

trace が扱わないことをまとめます。

- トレースには `gen_ai.` の名前を書きません。
- `gen_ai.` の名前は、画面へ送るエクスポーターの直前でだけ足します。
- 会話の中身を伏せる仕組みは作りません。
- トレースを見るための画面は作りません。
- OpenTelemetry Collector は使いません。

## 使い方

SDK から親スパンを作り、ハーネスに渡す例です。
トレースは SQLite に保存します。

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

ルートスパンは、`end` で閉じないと書き出されません。
`sdk.shutdown()` は、たまったトレースを書き出してから終わります。
