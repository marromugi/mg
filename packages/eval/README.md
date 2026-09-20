# @mg/eval

保存したトレースを読み直し、実行の判定に使う関数を持つパッケージです。

## 役割

トレースは、スパンのツリーの形で保存されています。ツリーには LLM の呼び出しや、
ツールの実行、ゲートの判定が混ざって並んでいます。

判定を書く人が、毎回このツリーをたどるのは手間です。
そこで、ツリーを実行のビューに読み解く関数を先に持ちます。

- ツリーを読み解きます。
  時間順のステップの列と、最後の応答と、ターンの回数を取り出します。
- ステップの列を、文章に書き起こします。
  人と Estimator の両方が読める形です。
- 判定の型を決めます。
  規則でも Estimator でも、同じ形で扱えます。
- 判定の配列を、書いた順に全部実行します。
  1 件の実行の合否と、判定ごとの結果を返します。

読み解きの入力は、リーダーが返すトレースのツリーだけです。
実行の結果（`HarnessResult`）は受け取りません。

ゲートの配下にある LLM の呼び出しは、ハーネスのターンに数えません。
判定用の呼び出しは、実行そのもののステップではないからです。

### ツリーを実行のビューに読み解く

`viewRun` は、`@mg/trace/store` が返す `SessionTree` を受け取ります。
返すのは `RunView` です。

```ts
import { viewRun } from "@mg/eval";

const view = viewRun(sessionTree);

view.steps; // llm / tool / gate / subagent が時間順に並んだステップの列
view.turnCount; // ハーネスのターンの回数
view.finalText; // 最後の応答の文章
view.usage; // トークン使用量の合計
```

ツリーの中から実行が見つからないときは、`NoRunInSessionError` を投げます。

### サブエージェントの手順

サブエージェントの呼び出しは、`mg.subagent` のスパンで記録されています。

`view.steps` には、サブエージェントの手順も時間順に混ざります。
ツールの手順の列（`view.toolSteps`）には入りません。

```ts
view.subagentSteps; // サブエージェントの手順だけの列
```

サブエージェントの手順は、名前と呼び出しの ID と引数と結果を持ちます。
呼び出しごとに新しく作る、子の会話のスレッドの ID も持ちます。

子の会話は、走行と同じセッションの中にある別のトレースです。
`usage` とターンの回数と `finalText` は、走行のトレースの分だけです。
子の会話の分は混ざりません。

`viewRun` は、子の会話のトレースを読みに行きません。
サブエージェントの手順が持つのは、スレッドの ID までです。

## 判定のインターフェース

判定は `Check` という 1 つの型で扱います。
規則で決める判定も、Estimator に聞く判定も同じ形です。

`Check` が持つのは、名前と判定を行う関数だけです。
関数は、トレースのツリーと実行のビューを受け取ります。
返すのは、合格かどうかとその理由です。

```ts
import type { Check } from "@mg/eval";

const myCheck: Check = {
  name: "no-secrets-in-output",
  async evaluate({ session, view }) {
    const ok = !view.finalText?.includes("SECRET");
    return {
      passed: ok,
      reason: ok ? "問題なし" : "秘密の値が含まれる",
    };
  },
};
```

`evaluate` は、トレースのツリーと判定の配列を受け取ります。
配列は、書いた順に全部実行します。
1 つの判定が落ちても、残りの判定は止めません。

実行のビュー（`RunView`）は、1 回だけ読み解きます。
どの判定にも、同じものを渡します。

```ts
import { evaluate } from "@mg/eval";

const verdict = await evaluate(session, [checkA, checkB]);

verdict.passed; // 全部の判定が合格したときだけ true
verdict.checks; // 判定ごとの結果。配列と同じ順で並ぶ
```

判定ごとの結果は、次の 3 つの状態のどれかになります。

| 状態     | 意味                       |
| -------- | -------------------------- |
| `passed` | 合格した状態               |
| `failed` | 不合格だった状態           |
| `error`  | 判定そのものが失敗した状態 |

判定そのものの失敗は、不合格とは区別します。
不合格は「基準に届かなかった」ことを表します。
失敗は「判定が動かせなかった」ことを表します。

件の合否は、全部の判定が合格したときだけ合格です。
1 つでも不合格か失敗があれば、件は不合格になります。
判定を 1 つも渡さなければ、件は合格として扱います。

中断のシグナル（`AbortSignal`）だけは、ラップせずにそのまま投げ直します。
判定の途中でシグナルが中断されると、`evaluate` もそこで止まります。

## 規則

機械的に調べられる条件は、規則で判定します。
ツールが呼ばれた回数や、最後の応答の中身などです。

`rule` は、名前と関数から `Check` を作るインターフェースです。
関数は実行のビュー（`RunView`）を受け取り、合否を返します。
真偽値だけを返しても、理由や詳細を添えて返しても構いません。

```ts
import { rule } from "@mg/eval";

const withinToolLimit = rule("bash-within-3", (view) => {
  return (
    view.toolSteps.filter((step) => step.name === "bash").length <= 3
  );
});

const hasFinalText = rule("has-final-text", (view) => {
  const passed = view.finalText !== undefined;
  return {
    passed,
    reason: passed ? "最後の応答がある" : "最後の応答が空",
  };
});
```

規則の名前を空文字にすると、`rule` は `RangeError` を投げます。

判定そのものが投げた例外は、`rule` を素通りします。
`evaluate` がその例外を受け取り、`error` の状態に変えます。

上の 2 つの見本は説明のためのもので、パッケージからは出しません。
ツールを呼んだ回数の上限などの既製の規則も、このパッケージには含めません。
判定として使うときは、それぞれのプロジェクトで書いてください。

## Estimator

機械的に書けない条件は、意味で判定します。
core の `Estimator` は、文章と質問を受け取り、答えが「はい」である確率を返します。

`createEstimatorChecker` は、`Estimator` の実装から判定のインターフェースを作ります。

```ts
import { createJevEstimator } from "@mg/core";
import { createEstimatorChecker } from "@mg/eval";

const estimatorCheck = createEstimatorChecker({
  estimator: createJevEstimator({ apiKey: process.env.JEV_API_KEY! }),
});
```

このインターフェースに名前と質問と境目を渡すと、判定（`Check`）ができます。
質問の文章は、判定を書く人が決めます。

```ts
const isPolite = estimatorCheck({
  name: "polite-reply",
  question: "最後の返事は丁寧な言い方ですか?",
  threshold: 0.9,
});
```

`EstimatorCheckOptions` が受け取るのは、次の 3 つです。

| フィールド  | 意味                                      |
| ----------- | ----------------------------------------- |
| `name`      | 判定の名前です。                          |
| `question`  | Estimator に投げる質問の文章です。        |
| `threshold` | 合格の境目です。省くと `0.9` になります。 |

境目は、確率がその値以上なら合格という意味です。
`0.9` なら「9 割以上の確率で合格」という基準になります。

判定は、走行の書き起こしと質問を `Estimator` に送ります。
返った確率を境目と比べ、結果には確率と境目の両方を残します。
理由の文章にも、確率と境目の数値を出します。

`Estimator` の呼び出しが失敗すると、`EstimatorCheckError` に包み直します。
元のエラーは `cause` として残ります。
中断の合図（`AbortSignal`）だけは、包まずにそのまま投げ直します。

## 書き起こし

`transcribe` は、`RunView` を人と Estimator が読める文章に書き起こします。
Estimator の判定は、既定でこの関数を使って走行を文章にします。

```ts
import { transcribe } from "@mg/eval";

const text = transcribe(view);
```

ツールの結果が長いときは、上限の文字数で切れます。

```ts
transcribe(view, { maxToolResultLength: 500 });
```

サブエージェントの手順は、`[subagent <名前>] <結果>` の 1 かたまりです。
結果が長いときは、ツールの結果と同じ上限で切れます。

誤りで終わったサブエージェントの手順は、次の形になります。

```
[subagent <名前> error] <誤りの文>
```

書き起こしを差し替えたいときは、`createEstimatorChecker` に渡します。

```ts
const estimatorCheck = createEstimatorChecker({
  estimator: createJevEstimator({ apiKey: process.env.JEV_API_KEY! }),
  transcribe: (view) => view.finalText ?? "",
});
```

## やらないこと

- 規則や Estimator による判定そのものの中身（既製のポリシー）は持ちません。
  質問の文章や境目の値は、判定を書く側が決めます。
- トレースの語彙（`SPAN` と `ATTR`）や `@mg/trace/store` には手を入れません。
- 判定の結果をトレースに書き戻しません。

## 使い方

`runner` で走らせた 1 件のセッションを、規則と Estimator の両方で判定する例です。

```ts
import { createJevEstimator } from "@mg/core";
import { createEstimatorChecker, evaluate, rule } from "@mg/eval";
import { JsonlTraceReader } from "@mg/trace/store";

const estimatorCheck = createEstimatorChecker({
  estimator: createJevEstimator({
    apiKey: process.env.TYPESAFE_API_KEY!,
  }),
});

const checks = [
  rule("has-final-text", (view) => view.finalText !== undefined),
  estimatorCheck({
    name: "answers-with-listing",
    question:
      "Does the final assistant reply report the actual output of ls?",
    threshold: 0.9,
  }),
];

const session = await new JsonlTraceReader("./trace.jsonl").readSession(
  sessionId,
);
const verdict = await evaluate(session, checks);

verdict.passed; // 規則と Estimator の両方が合格したときだけ true
```

`runMany` で複数件を走らせ、件ごとに判定する完全な見本は、
`runs/eval-example.ts` にあります。
