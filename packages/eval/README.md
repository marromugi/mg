# @mg/eval

保存したトレースを読み直し、実行の判定に使う関数を持つパッケージです。

## 背景

トレースは、スパンのツリーの形で保存されています。ツリーには LLM の呼び出しや、
ツールの実行、ゲートの判定が混ざって並んでいます。

判定を書く人が、毎回このツリーをたどるのは手間です。
そこで、ツリーを実行のビューに読み解く関数を先に持ちます。

## 役割

- ツリーを読み解きます。
  時間順のステップの列と、最後の応答と、ターンの回数を取り出します。
- ステップの列を、文章に書き起こします。
  人と Jev の両方が読める形です。

読み解きの入力は、リーダーが返すトレースのツリーだけです。
実行の結果（`HarnessResult`）は受け取りません。

ゲートの配下にある LLM の呼び出しは、ハーネスのターンに数えません。
判定用の呼び出しは、実行そのもののステップではないからです。

## やらないこと

- 判定そのもの（`Check` の型や `evaluate`）は持ちません。
- 規則や Jev による判定の実装も持ちません。
- トレースの語彙（`SPAN` と `ATTR`）や `@mg/trace/store` には手を入れません。

## 使い方

### ツリーを実行のビューに読み解く

`viewRun` は、`@mg/trace/store` が返す `SessionTree` を受け取ります。
返すのは `RunView` です。

```ts
import { viewRun } from "@mg/eval";

const view = viewRun(sessionTree);

view.steps; // llm / tool / gate が時間順に並んだステップの列
view.turnCount; // ハーネスのターンの回数
view.finalText; // 最後の応答の文章
view.usage; // トークン使用量の合計
```

ツリーの中から実行が見つからないときは、`NoRunInSessionError` を投げます。

### ステップの列を文章に書き起こす

`transcribe` は、`RunView` を人と Jev が読める文章に書き起こします。

```ts
import { transcribe } from "@mg/eval";

const text = transcribe(view);
```

ツールの結果が長いときは、上限の文字数で切れます。

```ts
transcribe(view, { maxToolResultLength: 500 });
```

判定のインターフェース（`Check` の型や `evaluate`）は、別の issue で足します。
