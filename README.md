# mg

LLM で動くエージェントのハーネスを試すための土台です。

## 目的

ハーネスとは、LLM と道具をつないで仕事をさせる仕組みです。

このリポジトリは、ハーネスを測って直し続けられる土台を作ります。
その土台の上で、形の軸のハーネスに取り組みます。

ハーネスは、目指すものによって結果の軸と形の軸に分かれます。
それぞれの違いを表にまとめます。

| 軸 | 目指すもの | 終わり | 測り方 |
| --- | --- | --- | --- |
| 結果 | 課題が正しく片づくこと | あり | 最終状態を機械で採点 |
| 形 | 一貫した話し方と記憶と会話の形式 | なし | 出力そのものを人か LLM が判定 |

## パッケージ

いまあるパッケージと、その役割を表にまとめます。

| パッケージ | 役割 |
| --- | --- |
| [`@mg/core`](packages/core/README.md) | 接続先の抽象化と、道具の共通の型 |
| [`@mg/tools`](packages/tools/README.md) | ハーネスが共通で使う組み込みの道具 |
| [`@mg/harness`](packages/harness/README.md) | ハーネスが従う共通の入り口と出口の型 |
| [`@mg/harness-loop`](packages/harness-loop/README.md) | 道具の呼び出しを繰り返すループ型のハーネス |

名前を選ぶと、各パッケージの README を読めます。

### 新しいコードの置き場所

足したいものごとに、置く場所を表にまとめます。

| 足したいもの | 置く場所 |
| --- | --- |
| 別の接続先の実装 | core |
| 道具の型や実行の部品 | core |
| ハーネスが共通で使う道具 | tools |
| 1 つのハーネスだけで使う道具 | ハーネス（core の型で書く） |
| 道具の呼び出しの繰り返し | harness-loop |
| 検証の失敗を LLM にどう返すか | harness-loop |
| 形の軸のハーネスの部品（記憶、想起、振り返り、出し方） | harness-persona（これから作るもの） |

迷ったときは、環境に依存するかを見ます。
子プロセスのように環境に依存するものは、core に置きません。

## 依存の向き

パッケージ同士の依存を図にします。
矢印は、使う側から使われる側への向きです。

<table>
  <tr>
    <td align="center" colspan="5"><code>@mg/harness-loop</code></td>
  </tr>
  <tr>
    <td align="center">↓</td>
    <td></td>
    <td align="center">↓</td>
    <td></td>
    <td align="center">↓</td>
  </tr>
  <tr>
    <td align="center"><code>@mg/tools</code></td>
    <td align="center">→</td>
    <td align="center"><code>@mg/core</code></td>
    <td align="center">←</td>
    <td align="center"><code>@mg/harness</code></td>
  </tr>
</table>

- harness-loop は、core と tools と harness の 3 つを使います。
- tools と harness は、それぞれ core を使います。
- core は、このリポジトリの他のパッケージに依存しません。

## 開発

どのコマンドも、リポジトリの一番上で実行します。
ビルドや検査は、すべてのパッケージに対して動きます。

```sh
pnpm install    # 依存を入れる
pnpm build      # ビルドする
pnpm typecheck  # 型を調べる
pnpm test       # テストを走らせる
```
