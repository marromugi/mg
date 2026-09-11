# @mg/harness

ハーネスが何であっても従う、共通の入り口と出口を決めるパッケージです。

ハーネスとは、LLM と道具をつないで仕事を進める仕組みです。
このパッケージは、形だけを決めます。
進め方までは決めません。

## 役割

harness の役割は 3 つです。

- ハーネスに渡す入力の型を決めます。
- ハーネスが順に返す出来事の型を決めます。
- 出来事の列から、最後の結果だけを取り出す部品を持ちます。

### 入力

ハーネスには、会話の履歴を渡します。
途中で止めるための合図も渡せます。
記録の相手も渡せますが、省略もできます。

### 出来事

ハーネスは、入力を受け取って出来事を返す関数です。
出来事の名前をまとめます。

```
text-delta   文章の断片が届いた
tool-call    道具の呼び出しが届いた
tool-result  道具の結果が届いた
turn         1 回分のやり取りが終わった
done         ハーネス全体が終わった
```

全体の終わりの出来事には、3 つの中身があります。

- 終わった理由です。
- そこまでの会話です。
- 使った量です。

### 結果をまとめる部品

`collect` は、出来事の列を順に見ます。
全体の終わりの出来事が来たら、中の結果を返します。
来ないまま列が終わったときは、例外を投げます。

## やらないこと

次のことは harness の外に任せます。

- 道具の呼び出しを繰り返す進め方は持ちません。harness-loop などの仕事です。
- 接続先とのやり取りはしません。LLM との通信は core の仕事です。
- 道具の実体は持ちません。

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
