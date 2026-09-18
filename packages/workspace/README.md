# @mg/workspace

手元とは別の機械で作業するための、土台のパッケージです。

作業場が束ねるのは、別の機械につなぐ方法です。
コードでは、これを接続方法（connector）と呼びます。
接続方法をまとめたものを、作業場（workspace）と呼びます。

## 役割

- 作業場の型を決めます。
  作業場は、名前と接続方法の並びです。
- 接続方法の型を決めます。
  接続方法が持つのは、開く操作だけです。
- 作業場を開く部品 `openWorkspace` を持ちます。
  全部の接続を開き、道具を 1 つの一覧にまとめます。
- 開く失敗と閉じる失敗のための、専用の例外を持ちます。

### 型の分け方

接続方法は、開く操作だけを持ちます。

開いた接続が持つのは、道具の一覧と閉じる操作だけです。
できる操作の一覧は、別の型では持ちません。
返す道具の集合が、できる操作の一覧そのものだからです。

SSH や CDP のような具体的な方法は、この型の実装です。
型の側には、方法ごとの分岐を入れません。

## やらないこと

- SSH と CDP の実装は、まだ持ちません。
- runner への組み込みは、まだ持ちません。
- 記録は、持ちません。
  記録は、runner の側で付けます。
- 道具の実体は、持ちません。
  道具は、接続方法の実装が返します。

## 使い方

作業場は `defineWorkspace` で作ります。
渡すのは、名前と接続方法の並びです。

```ts
import { defineWorkspace, openWorkspace } from "@mg/workspace";

const workspace = defineWorkspace({
  name: "build-machine",
  connectors: [sshConnector, cdpConnector],
});

const opened = await openWorkspace(workspace);

// opened.tools をハーネスに渡します

await opened.close();
```

`openWorkspace` は、接続方法を並びの順に開きます。
同時には開きません。

途中で 1 つでも失敗すると、開いた分を閉じます。
そのあとで、例外を投げます。
道具の名前が方法をまたいで重なったときも、同じです。

中断の合図は、包まずにそのまま通します。
すでに中断済みの合図を渡すと、1 つも開かずに投げます。

投げる例外を表にまとめます。

| 例外                     | 投げるとき                       |
| ------------------------ | -------------------------------- |
| `ConnectorOpenError`     | 接続方法を開けなかったとき       |
| `DuplicateToolNameError` | 道具の名前が重なったとき         |
| `WorkspaceCloseError`    | 閉じるときに、接続が失敗したとき |

`ConnectorOpenError` は `kind` と `index` を持ちます。
元の例外は `cause` に入ります。

`DuplicateToolNameError` は `toolName` を持ちます。
重なった接続方法の `kind` の並びは、`kinds` に入ります。

`WorkspaceCloseError` は、失敗した例外の並び `errors` を持ちます。
最初の 1 つは、`cause` にも入ります。

`isWorkspaceError` で、これらの例外かどうかを判定できます。

返る `close` は、開いた接続を逆順に閉じます。
1 つが失敗しても、残りは閉じ続けます。
2 回目以降に呼んでも、何もしません。

## 接続方法ごとの前提

各接続方法の前提は、ここに書きます。
前提とは、機械の側に必要なものです。
整えるのは、機械を持つ人です。

### SSH

### CDP
