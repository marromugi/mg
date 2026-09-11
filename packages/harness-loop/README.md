# @mg/harness-loop

道具の呼び出しを繰り返す、ループ型のハーネスを作るパッケージです。

## 役割

harness-loop の役割は 3 つです。

- 接続先と道具から、@mg/harness の型に合うハーネスを作ります。
- 道具の実行に失敗しても、その旨を LLM に返して続けます。
- 一括と細切れの、2 通りの受け取り方を選べます。

### ループの流れ

`createLoopHarness` が返す関数は、次の流れを繰り返します。

- 接続先を呼び、返った文章と道具の呼び出しを出来事として流します。
- 道具の呼び出しがなければ、そこで終わりの出来事を返します。
- 道具の呼び出しがあれば、それぞれを実行して会話に結果を足します。
- 回数の上限に届いたら、そこで終わりにします。

### 道具の失敗

道具の実行に失敗しても、例外を投げずに道具の結果に変えます。
その変換は、`toolErrorToMessage` が受け持ちます。
中断の合図による停止だけは、そのまま例外として通します。

## やらないこと

次のことは harness-loop の外に任せます。

- ハーネスの入力と出来事の型は持ちません。@mg/harness を使います。
- 道具の実体は持ちません。@mg/tools などから渡します。
- 接続先の実装は持ちません。@mg/core の型に合う接続先を渡します。

## 使い方

作るときに渡すものを表にまとめます。

| 名前 | 内容 |
| --- | --- |
| `provider` | 使う接続先 |
| `model` | 使うモデルの名前 |
| `tools` | 使わせる道具の一覧（省略できる） |
| `maxTurns` | 繰り返しの回数の上限 |
| `stream` | 細切れで受け取るか（省くと true） |

```ts
import { createLoopHarness } from "@mg/harness-loop";
import { collect } from "@mg/harness";

const harness = createLoopHarness({
  provider,
  model: "openai/gpt-4o-mini",
  tools: [bashTool],
  maxTurns: 10,
});

const result = await collect(harness({ messages: [{ role: "user", content: "..." }] }));
```
