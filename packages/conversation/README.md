# @mg/conversation

会話を保存して、あとから読み返すための土台のパッケージです。

会話とは、1 体のエージェントが LLM とやり取りする、メッセージの列です。
会話は id で区別します。

保存の単位は、1 回の走行で増えた分です。
これを「エントリー」と呼びます。

## 役割

- 会話のメッセージの型を決めます。
  core のメッセージの型から、system を除いたものです。
- エントリーの型を決めます。
  エントリーは、メッセージを 1 件以上持ちます。
- 読む範囲の型を決めます。
  範囲は「全部」か「最後の n 件」のどちらかです。
- 読み出しの結果の型を決めます。
  結果は、エントリーの並びと、その会話のエントリーの総数を持ちます。
- 会話の保存のインターフェース `ConversationStore` を決めます。
  操作は、作成と読み出しと追記の 3 つです。
- 保存と確かめが使う、専用のエラーを持ちます。
- 追記の前に使う、2 つの確かめの関数を持ちます。
- `ConversationStore` を、プロセスの中だけで実装したものを
  持ちます。

### 型の分け方

会話のメッセージの型 `ConversationMessage` に、system のメッセージは
代入できません。
system は、走行のたびに使う側が渡すものだからです。

エントリーの型 `ConversationEntry` は、メッセージを 1 件以上持ちます。
メッセージが 0 件のエントリーは、型の検査で通りません。

読む範囲の型 `ReadRange` に、既定はありません。
読み出しの操作は、範囲を渡さずに呼べません。

## `ConversationStore`

インターフェースが持つ操作を表にまとめます。

| 操作     | すること                                                 |
| -------- | -------------------------------------------------------- |
| `create` | id を受け取り、エントリーが 0 件の会話を作ります。       |
| `read`   | id と範囲を受け取り、エントリーの並びと総数を返します。  |
| `append` | id とエントリー 1 件と、読んだ時点の総数を受け取ります。 |

`append` に渡す総数は、読み出した時点でのエントリーの総数です。
保存先の実際の総数と違うと、追記は失敗します。

## メモリ上の保存

`createMemoryConversationStore` は、`ConversationStore` を
プロセスの中だけで実装したものです。

引数を受け取りません。
呼ぶたびに、会話を 1 件も持たない新しい保存を返します。

```ts
import { createMemoryConversationStore } from "@mg/conversation";

const store = createMemoryConversationStore();
await store.create("jev");
await store.append("jev", entry, 0);
const slice = await store.read("jev", { kind: "all" });
```

保存した会話は、プロセスが終わると消えます。
別に作った保存どうしは、会話を共有しません。

## 2 つの確かめ

追記する前に使う、2 つの関数を持ちます。
どちらも、渡したエントリーを書き換えません。
保存先も会話の id も受け取らず、エントリーだけを見ます。

| 関数                | 確かめること                                      |
| ------------------- | ------------------------------------------------- |
| `assertJsonEntry`   | エントリーの値が、JSON にして戻しても同じかどうか |
| `assertToolPairing` | ツールの呼び出しと結果が、対になっているかどうか  |

問題がなければ、どちらも何も返しません。
問題があれば、専用のエラーを投げます。

`assertJsonEntry` が通す値は、文字列と、真偽値と、null です。
有限で -0 でない数も通ります。
それらの配列と、それらを値に持つ素のオブジェクトも通ります。
それ以外の値を見つけると、`EntryNotJsonError` を投げます。
場所は、`messages` から始まる文字列です。
配列の添字は `[n]`、オブジェクトのキーは `.key` でつなぎます。

`assertToolPairing` が通すエントリーは、呼び出しのどれにも後ろに
同じ id の結果があるエントリーです。
結果のどれにも、前に同じ id の呼び出しがあります。
ツールを使わないエントリーも通します。
対になっていない箇所を見つけると、`EntryToolPairingError` を
投げます。

## エラー

投げる例外を表にまとめます。

| 例外                        | 投げるとき                                                     |
| --------------------------- | -------------------------------------------------------------- |
| `ConversationExistsError`   | すでにある id で、作成したとき                                 |
| `ConversationNotFoundError` | 作成されていない id で、読み出しか追記をしたとき               |
| `ConversationRangeError`    | 範囲の件数が、正の整数でないとき                               |
| `ConversationConflictError` | 渡した総数と、保存先の実際の総数が違ったとき                   |
| `EntryNotJsonError`         | エントリーの値が、JSON にして戻すと同じにならないとき          |
| `EntryToolPairingError`     | ツールの呼び出しと結果が、エントリーの中で対になっていないとき |

`ConversationExistsError` と `ConversationNotFoundError` は、id
`conversationId` を持ちます。

`ConversationRangeError` は、渡された件数 `count` を持ちます。

`ConversationConflictError` は、`conversationId` と、渡された総数
`expectedLength` と、実際の総数 `actualLength` を持ちます。

`EntryNotJsonError` は、最初に見つかった値の場所 `path` を持ちます。

`EntryToolPairingError` は、種類 `kind` と、ツールの呼び出しの id
`toolCallId` を持ちます。
種類は、結果のない呼び出し `unanswered-call` と、呼び出しのない結果
`orphan-result` の 2 つです。

どの例外も、自分の名前を `name` に持ちます。

## やらないこと

- 会話の一覧と、削除と、名前づけは、持ちません。
- エントリーの時刻は、持ちません。
- id の選び方は、持ちません。
  id は、使う側が選びます。
- 読む範囲の選び方は、持ちません。
  範囲は、使う側が選びます。
- 伸びた会話の要約は、持ちません。
