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

- 判定の口の型を決めます。
  規則でも Jev でも、同じ形で扱えます。
- 判定の配列を、書いた順に全部走らせます。
  1 件の走行の合否と、判定ごとの結果を返します。

## やらないこと

- 規則や Jev による判定の実装は持ちません。
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

### 判定の口

判定は `Check` という 1 つの型で扱います。
規則で決める判定も、Jev に聞く判定も同じ形です。

`Check` が持つのは、名前と判定を行う関数だけです。
関数は、記録の木と走行の見え方を受け取ります。
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

`evaluate` は、記録の木と判定の配列を受け取ります。
配列は、書いた順に全部走らせます。
1 つの判定が落ちても、残りの判定は止めません。

走行の見え方（`RunView`）は、1 回だけ読み解きます。
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

中断の合図（`AbortSignal`）だけは、包まずにそのまま投げ直します。
判定の途中で合図が中断されると、`evaluate` もそこで止まります。

### 規則で判定する

機械的に調べられる条件は、規則で判定します。
ツールが呼ばれた回数や、最後の返事の中身などです。

`rule` は、名前と関数から `Check` を作るインターフェースです。
関数は走行の見え方（`RunView`）を受け取り、合否を返します。
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
    reason: passed ? "最後の返事がある" : "最後の返事が空",
  };
});
```

規則の名前を空文字にすると、`rule` は `RangeError` を投げます。

判定そのものが投げた例外は、`rule` を素通りします。
`evaluate` がその例外を受け取り、`error` の状態に変えます。

上の 2 つの見本は説明のためのもので、パッケージからは出しません。
ツールを呼んだ回数の上限などの既製の規則も、このパッケージには含めません。
判定として使うときは、それぞれのプロジェクトで書いてください。
