# @mg/memory

個体の記憶を保存して返すための、インターフェースと型のパッケージです。

個体とは、人格を持って会話するエージェントのことです。
記憶は、個体ごとに分かれています。

## 役割

- 記憶の 3 種類の型を決めます。
- 読み出しの選択と、書き込みの変更と、書き込みの返り値の型を決めます。
- 記憶の保存のインターフェース `MemoryStore` を決めます。
- 保存が使う、専用のエラーを持ちます。
- `MemoryStore` を実装する、メモリ上の保存 `createMemoryStore` を持ちます。
- `MemoryStore` を実装する、SQLite の保存 `openSqliteMemoryStore` を持ちます。

## 3 種類の記憶

記憶は、次の 3 種類です。
それぞれ別の型を持ちます。

| 型                    | 何の記憶か                    | 持つもの                        |
| --------------------- | ----------------------------- | ------------------------------- |
| `PersonaDocument`     | 個体自身の人格の文書          | 文章 `text` と版 `version`      |
| `ConversationSummary` | 1 つの会話の要約              | 文章 `text` と版 `version`      |
| `MemoryItem`          | 相手ごとに覚えている項目 1 件 | id、相手の id、文章、時刻、回数 |

`MemoryItem` の項目は、id と相手の id `counterpart` と文章 `text` を
持ちます。
作られた時刻 `createdAt` と、選ばれなかった回数 `misses` も持ちます。

人格の文書と会話の要約は、版を持ちます。
項目は版を持ちません。

## `MemoryStore`

インターフェースが持つ操作を表にまとめます。

| 操作     | すること                                                           |
| -------- | ------------------------------------------------------------------ |
| `create` | 個体の id と人格の文書の文章を受け取り、その個体の記憶を作ります。 |
| `read`   | 個体の id と選択を受け取り、記憶の一部を返します。                 |
| `write`  | 個体の id と変更を受け取り、記憶を書き換えます。                   |
| `delete` | 個体の id と項目の id の並びを受け取り、その項目を消します。       |

読み出しの選択の型は `MemorySelection` です。
相手の id の並び `counterparts` と、省ける会話の id `conversation` を持ちます。

読み出しの返り値の型は `MemoryView` です。
人格の文書 `persona` と、項目の並び `items` と、省ける会話の要約 `summary` を持ちます。

書き込みの変更の型は `MemoryChange` です。
次の 5 つを持ち、それぞれ省けます。

- `persona`: 人格の文書の新しい文章と、読んだ時点の版
- `summary`: 会話の要約の新しい文章と、会話の id と、読んだ時点の版
- `add`: 足す項目の並び。項目の型は `NewMemoryItem` で、`misses` を持ちません
- `hits`: 選ばれた項目の id の並び
- `misses`: 選ばれなかった項目の id の並び

書き込みの返り値の型は `MissCounts` です。
選ばれなかった項目の id をキーに、書き込み後の回数を持つ、素のオブジェクトです。

## エラー

投げる例外を表にまとめます。

| 例外                      | 投げるとき                               |
| ------------------------- | ---------------------------------------- |
| `PersonaExistsError`      | すでにある id で作成したとき             |
| `PersonaNotFoundError`    | 作成されていない個体を扱ったとき         |
| `MemoryConflictError`     | 人格か要約の版が実際の版と違ったとき     |
| `MemoryItemExistsError`   | 足す項目の id が、すでにあったとき       |
| `MemoryItemNotFoundError` | 指定した項目の id が、保存になかったとき |
| `MemoryArgumentError`     | 引数が誤っていたとき                     |

`PersonaExistsError` と `PersonaNotFoundError` は、個体の id `personaId` を持ちます。

`MemoryConflictError` は、個体の id `personaId` と、食い違った項目の並び
`mismatches` を持ちます。
`mismatches` の各項目は、種類 `kind`（`persona` か `summary`）と、省ける鍵
`key` と、渡された版 `expectedVersion` と、実際の版 `actualVersion` を持ちます。

`MemoryItemExistsError` と `MemoryItemNotFoundError` は、個体の id
`personaId` と、対象の項目の id の並び `itemIds` を持ちます。

`MemoryArgumentError` は、種類 `kind` と、詳しい説明 `detail` を持ちます。
種類は、次の 8 つです。

- `empty-id`: id が空のとき
- `empty-text`: 文章が空のとき
- `duplicate-id`: id が並びの中で重複したとき
- `hit-and-miss`: 同じ id が選ばれた項目と選ばれなかった項目の両方にあるとき
- `empty-change`: 変更の 5 つが、すべて省かれているか 0 件のとき
- `invalid-version`: 版が 0 以上の整数でないとき
- `invalid-time`: 作られた時刻が有限の数でないとき
- `empty-list`: 削除する項目の並びが 0 件のとき

どの例外も、自分の名前を `name` に持ちます。

## メモリ上の保存

`createMemoryStore` は、`MemoryStore` をプロセスの中だけで実装したものです。

引数を受け取りません。
呼ぶたびに、記憶を 1 件も持たない新しい保存を返します。

```ts
import { createMemoryStore } from "@mg/memory";

const store = createMemoryStore();
await store.create("jev", "I am Jev.");
await store.write("jev", { add: [item] });
const view = await store.read("jev", { counterparts: ["alice"] });
```

保存した記憶は、プロセスが終わると消えます。
別に作った保存どうしは、記憶を共有しません。

## SQLite の保存

`openSqliteMemoryStore` は、`MemoryStore` を SQLite で実装したものです。
`@mg/memory` の主の入口とは別の入口から出します。

```ts
import { openSqliteMemoryStore } from "@mg/memory/sqlite";

const store = await openSqliteMemoryStore("path/to/memory.db");
await store.create("jev", "I am Jev.");
await store.write("jev", { add: [item] });
const view = await store.read("jev", { counterparts: ["alice"] });
```

引数は、開くファイルのパスです。
保存先のディレクトリがなければ作ります。
テーブルがなければ作ります。

パスに `":memory:"` を渡すと、ファイルを作らずに開けます。

同じパスをもう一度開くと、前に保存した記憶が読めます。
ファイルが残っていれば、プロセスをまたいでも記憶は残ります。

同じパスを 2 つの保存が同時に開いていても、版の照合と項目の存在の
確かめは働きます。
先に書いた側だけが残ります。
後から書いた側は、`MemoryConflictError` か、項目のエラーで失敗します。

保存先を開けないときは、開く関数がそのエラーで拒否されます。
保存は返りません。

SQLite とやり取りするライブラリは、この入口の中だけで読み込みます。
`@mg/memory` の主の入口からは読み込みません。

## やらないこと

- 忘却の規則は、持ちません。
  回数の上限や、相手ごとの項目の上限は、使う側が決めます。
- このリポジトリの他のパッケージへの依存は、持ちません。
