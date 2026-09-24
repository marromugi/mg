# @mg/persona

個体の想起と振り返りのための、インターフェースと型のパッケージです。

個体とは、人格を持って生き続ける 1 体のエージェントのことです。
走らせる側は、この 2 つのインターフェースだけを見て、個体の中身を知りません。

## 役割

- 想起と振り返りの操作を持つインターフェース `Persona` を決めます。
- 会話から何を覚えるかの候補を決めるインターフェース `Extractor` を決めます。
- 2 つのインターフェースの入出力の型を決めます。
- 想起の実装 `createRecall` を持ちます。
- 想起と決め手が使う、専用のエラーを持ちます。

`Persona` をまるごと組み立てる `createPersona` と、決め手の実装
`createLlmExtractor` は、まだこのパッケージにありません。
後の issue で足します。

## `Persona`

`Persona<TInput, TRead>` は、1 体の個体を表すインターフェースです。
id を公開し、想起 `recall` と振り返り `remember` の 2 つの操作を持ちます。
どちらの操作も、個体の id を受け取りません。

`TInput` は、想起のいまの入力の型です。
`TRead` は、想起が返し振り返りが受け取る、読んだものの型です。
中身は `Persona` の外から決まり、インターフェースはどちらの形も決めません。

| 操作       | 受け取るもの                                   | 返すもの                                |
| ---------- | ---------------------------------------------- | --------------------------------------- |
| `recall`   | 想起の要求 `RecallRequest<TInput>` と文脈      | 想起の結果 `Recall<TRead>`              |
| `remember` | 振り返りの要求 `RememberRequest<TRead>` と文脈 | 振り返りの結果 `RememberOutcome<TRead>` |

文脈の型は `PersonaContext` です。
中断の signal `signal` と、親になるスパン `trace` を持ち、どちらも省けます。

`RecallRequest<TInput>` は、相手の並び `counterparts` と、会話の id
`conversation` と、いまの入力 `input` を持ちます。
相手の型は `Counterpart` で、id `id` と表示名 `name` を持ちます。

`Recall<TRead>` は、指示の文章 `instruction` と、読んだもの `read` を持ちます。

`RememberRequest<TRead>` は、読んだもの `read` と、走行のエントリーの
メッセージの並び `entry` を持ちます。

## 想起

`createRecall(options)` は、`Persona.recall` として使える関数を作ります。
options は次を持ちます。

| 項目              | 内容                                                      |
| ----------------- | --------------------------------------------------------- |
| `id`              | この個体の id です。                                      |
| `store`           | `@mg/memory` の `MemoryStore` です。                      |
| `estimator`       | `@mg/core` の `Estimator` です。                          |
| `question`        | 「この入力に関係ある記憶はどれか」を問う質問の文章です。  |
| `noneDescription` | 「どれも関係ない」ラベルの説明の文章です。                |
| `ratio`           | 選ばれたラベルの確率に対する比の下限です。0 から 1 です。 |
| `headings`        | 相手の見出し `about` と、要約の見出し `earlier` です。    |

作った関数は、次の順に動きます。

1. 相手の並びの id と会話の id で、保存先から読み出します。
2. 読んだ項目を新しい順に、`estimator.limits.maxLabels` から 1 を
   引いた数だけ取り、候補にします。
3. 候補が 0 件なら、Estimator を呼ばず、選ばれた項目も 0 件にします。
4. 候補が 1 件以上なら、Estimator の `classify` を 1 回呼びます。
   判定の対象はいまの入力、ラベルは候補の文章と `noneDescription` です。
5. 選ばれたラベルが `none` なら、選ばれた項目は 0 件です。
   そうでなければ、確率が選ばれたラベルの確率に `ratio` を掛けた値
   以上の候補を選びます。
6. 人格の文章、相手ごとの見出しと選ばれた項目、要約の見出しと文章を
   組み合わせて、指示の文章にします。

相手の id か表示名か会話の id が空のとき、相手の id が重複するときは、
読み出す前に `RangeError` で拒否します。

指示の文章を組む部分は、`composeInstruction(read, headings)` という
純粋な関数に分けています。
読んだもの `RecallRead` と見出しだけから、指示の文章を返します。

`RecallRead` は、相手の並び `counterparts`、会話の id `conversation`、
人格の文書 `persona`、要約 `summary`（あれば）、相手ごとの読んだ項目の
全部 `items`、候補の項目の id の並び `candidates`、選ばれた項目の id の
並び `selected` を持ちます。

文脈にスパン `trace` があれば、その下に `mg.recall` のスパンを作ります。
属性は、個体の id、Estimator のモデル、候補の数、選ばれた項目の id の
JSON、ラベルごとの確率の JSON（Estimator を呼んだときだけ）です。
スパンの操作が失敗しても、想起の返り値は変わりません。

## 振り返りの結果

`RememberOutcome<TRead>` は、次の 4 つの形の合併型です。
`updated` と、`updated` が `false` のときの `reason` で見分けます。

| 形               | `updated` | `reason`          | 持つもの                                                                                  |
| ---------------- | --------- | ----------------- | ----------------------------------------------------------------------------------------- |
| 更新できた       | `true`    | なし              | 足した項目の id `added`、人格を書き換えたか `personaChanged`、消した項目の id `forgotten` |
| 決められなかった | `false`   | `"undecided"`     | 投げた値 `error` と、受け取った要求そのもの `request`                                     |
| 書けなかった     | `false`   | `"write-failed"`  | 投げた値 `error`                                                                          |
| 消せなかった     | `false`   | `"forget-failed"` | 投げた値 `error`、`added`、`personaChanged`、消せなかった項目の id `pending`              |

## `Extractor`

`Extractor` は、会話から何を覚えるかの候補を決めるインターフェースです。
版も id も時刻も持ちません。

`extract` は、入力 `ExtractorInput` と文脈を受け取り、候補
`Extraction` を返します。

`ExtractorInput` は、相手の並び `counterparts` と、いまの会話のメッセージの
並び `entry` と、いまの記憶 `memory` を持ちます。
`memory` は、人格の文章 `persona` と、相手ごとの読んだ項目の文章の並び
`items`（相手の id `counterpart` と文章 `text`）と、要約の文章 `summary`
（省けます）を持ちます。

`Extraction` は、会話の要約の新しい文章 `summary` と、相手の記憶の候補の
並び `items`（相手の id `counterpart` と文章 `text`）と、人格の文書の
新しい文章 `persona`（省けます）を持ちます。

## エラー

投げる例外を表にまとめます。

| 例外             | 投げるとき                                         |
| ---------------- | -------------------------------------------------- |
| `RecallError`    | 想起の中で、Estimator の呼び出しが失敗したとき     |
| `ExtractorError` | 決め手が、約束を守れない答えしか得られなかったとき |

`RecallError` と `ExtractorError` は、投げた値を `cause` に持ちます。
保存先が投げたエラーと、中断のエラー（`name` が `AbortError`）は、
`createRecall` が作った関数もそのまま投げます。

`ExtractorContractError` は、投げません。
決め手の答えが約束を破ったときに、振り返りが使います。
`RememberOutcome` の決められなかった形で、`error` に入って返ります。

`ExtractorContractError` は、種類 `kind` と、詳しい説明 `detail` を持ちます。
種類は、次の 3 つです。

- `unknown-counterpart`: 候補の相手の id が、渡された並びにないとき
- `empty-text`: 候補の文章が空のとき
- `duplicate-item`: 同じ相手の同じ文章が、候補に 2 つ以上あるとき

どの例外も、自分の名前を `name` に持ちます。

## やらないこと

- `Persona` をまるごと組み立てる `createPersona` と、決め手の実装
  `createLlmExtractor` は、持ちません。後の issue で足します。
- 振り返り `remember` の実装は、持ちません。後の issue で足します。
- 個体の記憶の保存は、持ちません。保存のインターフェースは `@mg/memory`
  が持ちます。
