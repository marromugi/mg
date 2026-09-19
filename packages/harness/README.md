# @mg/harness

ハーネスが何であっても従う、共通の入力と出力の型を決めるパッケージです。

ハーネスとは、LLM とツールをつないで仕事を進める仕組みです。
このパッケージは、形だけを決めます。
進め方までは決めません。

## 役割

harness の役割は 3 つです。

- ハーネスに渡す入力の型を決めます。
- ハーネスが順に返すイベントの型を決めます。
- イベントの列から、最後の結果だけを取り出す関数を持ちます。

### 入力

ハーネスには、会話の履歴を渡します。
途中で止めるためのシグナル（AbortSignal）も渡せます。
親スパンも渡せますが、省略もできます。

### イベント

ハーネスは、入力を受け取ってイベントを返す関数です。
イベントの名前をまとめます。

```
text-delta   文章の断片が届いた
tool-call    ツールの呼び出しが届いた
tool-result  ツールの結果が届いた
turn         1 回分のやり取りが終わった
done         ハーネス全体が終わった
```

全体の終わりのイベントには、3 つの中身があります。

- 終わった理由です。
- そこまでの会話です。
- 使った量です。

### 結果をまとめる関数

`collect` は、イベントの列を順に見ます。
全体の終わりのイベントが来たら、中の結果を返します。
来ないまま列が終わったときは、例外を投げます。

## やらないこと

次のことは harness の外に任せます。

- ツールの呼び出しを繰り返す進め方は持ちません。harness-loop などの仕事です。
- プロバイダーとのやり取りはしません。LLM との通信は core の仕事です。
- ツールの実装は持ちません。

## 使い方

ハーネスを作る側は、次の形の関数を用意します。

```ts
import type { Harness } from "@mg/harness";
import { collect } from "@mg/harness";

const harness: Harness = async function* (input) {
  yield { type: "text-delta", delta: "こんにちは" };
  yield {
    type: "done",
    result: {
      reason: "stop",
      messages: input.messages,
      usage: { inputTokens: 0, outputTokens: 0 },
    },
  };
};

const result = await collect(harness({ messages: [] }));
```
