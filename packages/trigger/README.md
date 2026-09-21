# @mg/trigger

走行を始めるべきかを、走行の前に判定するトリガーのパッケージです。

## 役割

判定する役割は、判定する時点で 3 つに分かれます。

| 時点       | 役割     | 問い                     | パッケージ |
| ---------- | -------- | ------------------------ | ---------- |
| 走行の前   | トリガー | 走行を始めるべきか       | trigger    |
| 走行の途中 | ゲート   | この操作を実行してよいか | gate       |
| 走行の後   | 評価     | 結果は正しかったか       | eval       |

ゲートは許可を問い、トリガーは必要を問います。
このパッケージは、トリガーの型とエラーと、判定のスパンを作る部品を持ちます。
Estimator を使う判定の実装も持ちます。

### 型と実装の分け方

トリガーは、入力とコンテキストを受け取り、判定を返すインターフェースです。

入力の型は、トリガーごとに決まる型引数です。
インターフェースは、入力の形を決めません。

コンテキストは、中断の signal と、親になるトレースのスパンです。
どちらも省けます。

判定は、発火したかどうかの真偽値と、理由の文字列です。
判定できなかったときは、専用のエラーを投げます。
原因は cause に持ちます。

### トレース

トリガーは、判定のたびにスパンを親の下に作ります。
親スパンは、コンテキストの `trace` で受け取ります。

親スパンを受け取ったときだけ、判定を `mg.trigger` として書きます。
受け取らなければ、何も記録せずに判定だけを返します。

親がスパンを作れずに投げたときも、記録なしで判定を続けます。
判定の処理そのものが投げたときは、スパンをそのエラーで閉じ、同じエラーを投げ直します。

スパンには、発火したかどうかと理由を書きます。
入力は書きません。
入力を記録するのは、トリガーを呼ぶ側の役目です。

## やらないこと

- 走行を始める入口は持ちません。

## 使い方

判定のインターフェースを実装すると、トリガーを作れます。

```ts
import type { Trigger } from "@mg/trigger";
import { TriggerError, withTriggerSpan } from "@mg/trigger";

type Input = { kind: string; text: string };

const trigger: Trigger<Input> = {
  decide: (input, context) =>
    withTriggerSpan(context, {}, async () => {
      if (input.text.length === 0) {
        throw new TriggerError("Trigger judgement failed");
      }
      return { fired: true, reason: "text is not empty" };
    }),
};

const decision = await trigger.decide({ kind: "issue", text: "hi" });
// decision は { fired: boolean, reason: string }
```

スパンを作る部品に渡すものを表にまとめます。

| 名前         | 内容                                                     |
| ------------ | -------------------------------------------------------- |
| `context`    | 呼び出し元から受け取ったコンテキスト（省くと記録しない） |
| `attributes` | スパンに追加で書く属性                                   |
| `body`       | 判定の処理。スパンを受け取り、判定を返す                 |

## Estimator を使う実装

Estimator から確率を受け取り、しきい値で判定する実装です。
`createEstimatorTrigger` で組み立てます。

```ts
import { createEstimatorTrigger } from "@mg/trigger";
import type { Estimator } from "@mg/core";

declare const estimator: Estimator;

const trigger = createEstimatorTrigger({
  estimator,
  prompt: "Fire when the assistant could help.",
});

const decision = await trigger.decide({
  kind: "tweet",
  text: "そういえば明日何かあったっけ",
});
```

組み立てに渡すものを表にまとめます。

| 名前        | 内容                                 |
| ----------- | ------------------------------------ |
| `estimator` | 確率を返す Estimator                 |
| `prompt`    | 判定の目的を書いた文                 |
| `threshold` | 発火とみなす確率の下限（省くと 0.7） |

しきい値は 0 から 1 の範囲で渡します。
範囲の外か、有限の数でなければ、組み立ての時点で `RangeError` を投げます。

判定は、入力の種類とテキストを Estimator に渡します。
テキストは `Kind: <種類>` の行と、入力のテキストをつないだものです。
質問は、渡した `prompt` と、固定の問いをつないだものです。

確率がしきい値以上なら発火します。
理由の文には、確率としきい値をそのまま書きます。

Estimator が投げたエラーは、トリガーのエラーに包んで投げます。
それ以外のエラーは、そのまま投げます。

親スパンを受け取ったときは、モデルと確率としきい値も書きます。
入力の種類とテキストは、この実装のスパンにも書きません。
