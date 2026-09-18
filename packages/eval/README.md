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

- 判定の型を決めます。
  規則でも Jev でも、同じ形で扱えます。
- 判定の配列を、書いた順に全部実行します。
  1 件の実行の合否と、判定ごとの結果を返します。

## やらないこと

- 規則や Jev による判定の実装は持ちません。
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

### 判定の型

判定は `Check` という 1 つの型で扱います。
規則で決める判定も、Jev に聞く判定も同じ形です。

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

### 規則で判定する

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

### Jev で判定する

機械的に書けない条件は、意味で判定します。
Jev は文章と質問を受け取り、答えが正しい確率を返します。

`createJevChecker` は、鍵と接続先から判定のインターフェースを作ります。

```ts
import { createJevChecker } from "@mg/eval";

const jevCheck = createJevChecker({
  apiKey: process.env.JEV_API_KEY!,
});
```

このインターフェースに名前と質問と境目を渡すと、判定（`Check`）ができます。
質問の文章は、判定を書く人が決めます。

```ts
const isPolite = jevCheck({
  name: "polite-reply",
  question: "最後の返事は丁寧な言い方ですか?",
  threshold: 0.9,
});
```

`JevCheckOptions` が受け取るのは、次の 3 つです。

| フィールド  | 意味                                      |
| ----------- | ----------------------------------------- |
| `name`      | 判定の名前です。                          |
| `question`  | Jev に投げる質問の文章です。              |
| `threshold` | 合格の境目です。省くと `0.9` になります。 |

境目は、確率がその値以上なら合格という意味です。
`0.9` なら「9 割以上の確率で合格」という基準になります。

判定は、走行の書き起こしと質問を Jev に送ります。
返った確率を境目と比べ、結果には確率と境目の両方を残します。
理由の文章にも、確率と境目の数値を出します。

書き起こしは、既定では `transcribe` を使います。
差し替えたいときは、`createJevChecker` に渡します。

```ts
const jevCheck = createJevChecker({
  apiKey: process.env.JEV_API_KEY!,
  transcribe: (view) => view.finalText ?? "",
});
```

通信が失敗したときや、返事の形が合わないときは `JevCheckError` を投げます。
中断の合図（`AbortSignal`）だけは、包まずにそのまま投げ直します。
