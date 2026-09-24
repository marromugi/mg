# @mg/persona

個体の想起と振り返りのための、インターフェースと型のパッケージです。

個体とは、人格を持って生き続ける 1 体のエージェントのことです。
走らせる側は、この 2 つのインターフェースだけを見て、個体の中身を知りません。

## 役割

- 想起と振り返りの操作を持つインターフェース `Persona` を決めます。
- 会話から何を覚えるかの候補を決めるインターフェース `Extractor` を決めます。
- 2 つのインターフェースの入出力の型を決めます。
- 想起と決め手が使う、専用のエラーを持ちます。

実装は、まだこのパッケージにありません。
`createPersona` と `createLlmExtractor` は、後の issue で足します。

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

- `Persona` と `Extractor` の実装は、持ちません。
  `createPersona` と `createLlmExtractor` は、後の issue で足します。
- 個体の記憶の保存は、持ちません。保存のインターフェースは `@mg/memory`
  が持ちます。
