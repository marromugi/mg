# @mg/eval

保存した記録を読み直し、走行の判定に使う部品を持つパッケージです。

## 背景

記録は、期間の木の形で保存されています。木には LLM の呼び出しや、
道具の実行、門番の判定が混ざって並んでいます。

判定を書く人が、毎回この木をたどるのは手間です。
そこで、木を走行の見え方に読み解く部品を先に持ちます。

## 役割

- 木を読み解きます。
  時間順の手順の列と、最後の返事と、往復の回数を取り出します。
- 手順の列を、文章に書き起こします。
  人と Jev の両方が読める形です。

読み解きの入力は、読み手が返す記録の木だけです。
走行の結果（`HarnessResult`）は受け取りません。

門番の配下にある LLM の呼び出しは、ハーネスの往復に数えません。
判定用の呼び出しは、走行そのものの手順ではないからです。

## やらないこと

- 判定そのもの（`Check` の型や `evaluate`）は持ちません。
- 規則や Jev による判定の実装も持ちません。
- 記録の語彙（`SPAN` と `ATTR`）や `@mg/trace/store` には手を入れません。

## 使い方

### 木を走行の見え方に読み解く

`viewRun` は、`@mg/trace/store` が返す `SessionTree` を受け取ります。
返すのは `RunView` です。

```ts
import { viewRun } from "@mg/eval";

const view = viewRun(sessionTree);

view.steps; // llm / tool / gate が時間順に並んだ手順の列
view.turnCount; // ハーネスの往復の回数
view.finalText; // 最後の返事の文章
view.usage; // トークン使用量の合計
```

木の中から走行が見つからないときは、`NoRunInSessionError` を投げます。

### 手順の列を文章に書き起こす

`transcribe` は、`RunView` を人と Jev が読める文章に書き起こします。

```ts
import { transcribe } from "@mg/eval";

const text = transcribe(view);
```

道具の結果が長いときは、上限の文字数で切れます。

```ts
transcribe(view, { maxToolResultLength: 500 });
```

判定の口（`Check` の型や `evaluate`）は、別の issue で足します。
