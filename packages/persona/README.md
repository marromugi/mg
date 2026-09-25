# @mg/persona

個体の想起と振り返りのための、インターフェースと型のパッケージです。

個体とは、人格を持って生き続ける 1 体のエージェントのことです。
走らせる側は、この 2 つのインターフェースだけを見て、個体の中身を知りません。

## 役割

- 想起と振り返りの操作を持つインターフェース `Persona` を決めます。
- 会話から何を覚えるかの候補を決めるインターフェース `Extractor` を決めます。
- 2 つのインターフェースの入出力の型を決めます。
- 想起の実装 `createRecall` を持ちます。
- 振り返りの実装 `createRemember` を持ちます。
- 想起と振り返りの部品から `Persona` を組み立てる `createPersona` を
  持ちます。
- 決め手の約束を確かめる純粋な関数 `checkExtraction` を持ちます。
- 会話のメッセージを書き起こしの文章にする `transcribe` を持ちます。
- 想起と決め手が使う、専用のエラーを持ちます。
- LLM で決め手を決める実装 `createLlmExtractor` を持ちます。

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

## 振り返り

`createRemember(options)` は、`Persona.remember` として使える関数を
作ります。options は次を持ちます。

| 項目         | 内容                                                                         |
| ------------ | ---------------------------------------------------------------------------- |
| `id`         | この個体の id です。                                                         |
| `store`      | `@mg/memory` の `MemoryStore` です。                                         |
| `estimator`  | `@mg/core` の `Estimator` です。                                             |
| `extractor`  | `Extractor` です。                                                           |
| `keep`       | 残す質問 `question` と、残すしきい値 `threshold` です。                      |
| `persona`    | 人格の質問 `question` と、人格のしきい値 `threshold` です。                  |
| `forgetting` | 忘却の上限 `missLimit` と、相手ごとの項目の上限 `itemsPerCounterpart` です。 |
| `now`        | 作られた時刻を返す関数です。                                                 |
| `newId`      | 項目の id を返す関数です。                                                   |

質問としきい値と上限に、既定はありません。どの値も呼び出し側が渡します。

作った関数は、次の順に動きます。

1. 決め手を、相手の並びと、走行のエントリーのメッセージと、いまの記憶
   （人格の文章、相手ごとの読んだ項目の全部の文章、要約の文章）で
   呼びます。文脈には、中断の signal と振り返りのスパンを渡します。
2. 決め手の答えを `checkExtraction` で確かめます。約束を破っていれば、
   `ExtractorContractError` を理由に決められなかった結果を返します。
3. 相手の記憶の候補ごとに、Estimator の確率を残す質問で呼びます。
   確率が残すしきい値以上の候補を残します。
4. 決め手が人格の新しい文章も返していれば、Estimator の確率を人格の
   質問で呼びます。判定の対象は、いまの人格の文章と新しい文章と、
   会話の書き起こしです。確率が人格のしきい値以上なら書き換えます。
5. 残す候補ごとに `newId` と `now` を呼び、新しい項目にします。
6. 保存先に 1 回書き込みます。要約と、人格（書き換えるときだけ）と、
   足す項目と、選ばれた項目の id と、候補のうち選ばれなかった項目の
   id を渡します。
7. 消す項目を決めます。書き込みが返した回数が忘却の上限以上の項目と、
   相手ごとに項目を新しい順に並べて上限を超えた分の項目です。
   1 件以上あれば、削除を 1 回呼びます。

決め手か Estimator か `newId` か `now` が投げたときは、投げた値と
受け取った要求そのものを持つ、決められなかった結果を返します。
中断のエラーも同じ形で返し、投げ直しません。
保存先の書き込みが投げたときは書けなかった結果を、削除が投げたときは
消せなかった結果を返します。`remember` は投げません。

`createRemember` が作る関数は、保存先の `write` と `delete` しか
呼びません。`read` は呼ばず、読んだもの `RecallRead` だけを使います。

文脈にスパン `trace` があれば、その下に `mg.reflection` のスパンを
作ります。属性は、個体の id、Estimator のモデル、相手の記憶の候補の
数、残した数、人格を書き換えたかどうか、消した項目の id の JSON です。
決め手には、この文脈のスパンを渡します。
失敗の結果を返すときは、その投げた値でスパンを閉じます。
スパンの操作が失敗しても、振り返りの返り値は変わりません。

## 決め手の約束を確かめる

`checkExtraction(extraction, counterparts)` は、決め手の答え
`Extraction` を約束に照らして確かめる、純粋な関数です。
答えと相手の並びだけから判定し、他には何も見ません。

確かめるのは、候補の相手の id が並びにあるか、要約と候補の文章と
人格の新しい文章（返したときだけ）がどれも空でないか、同じ相手の
同じ文章が重複していないかです。空白だけの文章も空として扱います。

約束を破っていれば、`ExtractorContractError` を返します。
守っていれば、`undefined` を返します。

## 書き起こし

`transcribe(messages)` は、会話のメッセージの並びを、決め手や振り返り
が使う書き起こしの文章にする関数です。

メッセージは 1 件ずつ、次の形の行に続けて本文を書きます。
段落の間は空行 1 つです。

| メッセージ           | 行の形                                         |
| -------------------- | ---------------------------------------------- |
| system               | `[system]`                                     |
| user                 | `[user]`                                       |
| assistant の文章     | `[assistant]`                                  |
| assistant の考え     | `[reasoning]`                                  |
| assistant の呼び出し | `[tool-call <id> <name>]`（本文は引数の JSON） |
| tool                 | `[tool-result <id>]`                           |

assistant のメッセージは、部分ごとに 1 つの行を作ります。

## 振り返りの結果

`RememberOutcome<TRead>` は、次の 4 つの形の合併型です。
`updated` と、`updated` が `false` のときの `reason` で見分けます。

| 形               | `updated` | `reason`          | 持つもの                                                                                  |
| ---------------- | --------- | ----------------- | ----------------------------------------------------------------------------------------- |
| 更新できた       | `true`    | なし              | 足した項目の id `added`、人格を書き換えたか `personaChanged`、消した項目の id `forgotten` |
| 決められなかった | `false`   | `"undecided"`     | 投げた値 `error` と、受け取った要求そのもの `request`                                     |
| 書けなかった     | `false`   | `"write-failed"`  | 投げた値 `error`                                                                          |
| 消せなかった     | `false`   | `"forget-failed"` | 投げた値 `error`、`added`、`personaChanged`、消せなかった項目の id `pending`              |

## 個体の組み立て

`createPersona(options)` は、想起と振り返りの部品から `Persona` を
1 体組み立てます。走らせる側は、組み立てたものの `recall` と
`remember` だけを見ます。

options は次を持ちます。

| 項目         | 内容                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `id`         | この個体の id です。                                                                            |
| `store`      | `@mg/memory` の `MemoryStore` です。                                                            |
| `estimator`  | `@mg/core` の `Estimator` です。                                                                |
| `recall`     | 想起の質問 `question`、関係なしの説明 `noneDescription`、割合 `ratio`、見出し `headings` です。 |
| `extractor`  | `Extractor` です。                                                                              |
| `keep`       | 残す質問 `question` と、残すしきい値 `threshold` です。                                         |
| `persona`    | 人格の質問 `question` と、人格のしきい値 `threshold` です。                                     |
| `forgetting` | 忘却の上限 `missLimit` と、相手ごとの項目の上限 `itemsPerCounterpart` です。                    |
| `now`        | 作られた時刻を返す関数です。省くと `Date.now` を使います。                                      |
| `newId`      | 項目の id を返す関数です。省くと nanoid を使います。                                            |

質問と説明と見出しと、割合としきい値と上限に、既定はありません。

組み立てた個体の `id` は渡した id で、`recall` と `remember` は想起と
振り返りの部品にそのまま委ねます。

組み立ての時点で、次のときに `RangeError` を投げます。

- 個体の id、質問、説明、見出しのどれかが空のとき。
- 割合としきい値が、0 から 1 の有限の数でないとき。
- 忘却の上限と相手ごとの項目の上限が、1 以上の整数でないとき。
- Estimator の `limits.maxLabels` が、2 以上の整数でないとき。
- 相手ごとの項目の上限が、`limits.maxLabels` から 1 を引いた数より
  大きいとき。

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

## LLM の決め手

`createLlmExtractor(options)` は、LLM で `Extractor` を組み立てます。
options はプロバイダー `provider` とモデル名 `model` と指示の文章
`instruction` を持ちます。

指示は必須です。使う側が測って選ぶものなので、既定は持ちません。
指示が空なら、組み立ての時点で `RangeError` を投げます。

組み立てた `extract` は、1 回につきプロバイダーの `generate` を
1 回だけ呼びます。呼ぶ前に、文脈の signal を確かめます。
中断済みなら、その理由で拒否し、プロバイダーは呼びません。

system は、固定の枠組みの文と渡された指示を、空行で挟んでつないだ
ものです。枠組みの文はこの実装だけが持ちます。

user は、次の段落を空行で区切って並べたものです。見出しの文面も、
この実装だけが持ちます。

1. `Counterparts:` の行と、相手ごとの `- <id> (<表示名>)` の行です。
2. `## Persona` の行と、人格の文章です。
3. 相手ごとの `## About <id> (<表示名>)` の行と、読んだ項目の文章を
   `- ` に続けて 1 行ずつです。項目のない相手は `(none)` と書きます。
4. `## Summary` の行と、要約の文章です。なければ `(none)` と書きます。
5. `## Conversation` の行と、`transcribe` による書き起こしです。

答えの形は、記憶を書く専用のツール `remember` の呼び出しを強制して
固定します。引数は、要約 `summary` と、相手の記憶の候補の並び
`items` と、人格の文書の新しい文章 `persona`（省けます）です。
引数をそのまま候補にして返します。

次のときは `ExtractorError` を投げます。

| とき                                      | `cause`                   |
| ----------------------------------------- | ------------------------- |
| プロバイダーが失敗したとき                | 投げた値                  |
| `remember` が 0 回か 2 回以上呼ばれたとき | 持ちません（`undefined`） |
| 引数の検証に落ちたとき                    | 検証の結果                |
| 約束を破る答えのとき                      | `ExtractorContractError`  |

中断のエラーは、そのまま投げ直します。

文脈にスパン `trace` があれば、プロバイダーをそのスパンの下に
`mg.llm` として記録するラッパーで包みます。

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
- `empty-text`: 要約と、候補の文章と、人格の新しい文章（返したとき
  だけ）のどれかが空のとき。空白だけの文章も空です。
- `duplicate-item`: 同じ相手の同じ文章が、候補に 2 つ以上あるとき

どの例外も、自分の名前を `name` に持ちます。

## やらないこと

- 個体の記憶の保存は、持ちません。保存のインターフェースは `@mg/memory`
  が持ちます。
