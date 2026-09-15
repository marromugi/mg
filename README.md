# mg

LLM で動くエージェントのハーネスを試すための土台です。

## 目的

ハーネスとは、LLM と道具をつないで仕事をさせる仕組みです。

このリポジトリは、ハーネスを測って直し続けられる土台を作ります。
その土台の上で、形の軸のハーネスに取り組みます。

ハーネスは、目指すものによって結果の軸と形の軸に分かれます。
それぞれの違いを表にまとめます。

| 軸   | 目指すもの                       | 終わり | 測り方                        |
| ---- | -------------------------------- | ------ | ----------------------------- |
| 結果 | 課題が正しく片づくこと           | あり   | 最終状態を機械で採点          |
| 形   | 一貫した話し方と記憶と会話の形式 | なし   | 出力そのものを人か LLM が判定 |

## パッケージ

いまあるパッケージと、その役割を表にまとめます。

| パッケージ                                            | 役割                                             |
| ----------------------------------------------------- | ------------------------------------------------ |
| [`@mg/core`](packages/core/README.md)                 | 接続先の抽象化と、道具の共通の型                 |
| [`@mg/tools`](packages/tools/README.md)               | ハーネスが共通で使う組み込みの道具               |
| [`@mg/harness`](packages/harness/README.md)           | ハーネスが従う共通の入り口と出口の型             |
| [`@mg/trace`](packages/trace/README.md)               | 記録の口の実体と、共通の語彙                     |
| [`@mg/harness-loop`](packages/harness-loop/README.md) | 道具の呼び出しを繰り返すループ型のハーネス       |
| [`@mg/runner`](packages/runner/README.md)             | 設定からハーネスを組み立て、記録を開いて走らせる |
| [`@mg/trace-ui`](packages/trace-ui/README.md)         | 保存した記録を見る画面                           |
| [`@mg/term`](packages/term/README.md)                 | 端末に書く文字の色と印                           |
| [`runs/`](runs/)                                      | 検証ごとの設定ファイルの置き場所                 |

名前を選ぶと、詳しい説明を読めます。

### 新しいコードの置き場所

足したいものごとに、置く場所を表にまとめます。

| 足したいもの                                           | 置く場所                            |
| ------------------------------------------------------ | ----------------------------------- |
| 別の接続先の実装                                       | core                                |
| 道具の型や実行の部品                                   | core                                |
| ハーネスが共通で使う道具                               | tools                               |
| 1 つのハーネスだけで使う道具                           | ハーネス（core の型で書く）         |
| 道具の呼び出しの繰り返し                               | harness-loop                        |
| 検証の失敗を LLM にどう返すか                          | harness-loop                        |
| 記録の語彙と保存先                                     | trace                               |
| 記録を見る画面                                         | trace-ui                            |
| 端末に出す文字の色と印                                 | term                                |
| 検証ごとの組み立ての設定                               | runs                                |
| 走らせ方そのもの（記録の開閉、複数件、読み込み）       | runner                              |
| 形の軸のハーネスの部品（記憶、想起、振り返り、出し方） | harness-persona（これから作るもの） |

迷ったときは、環境に依存するかを見ます。
子プロセスのように環境に依存するものは、core に置きません。

## 依存の向き

パッケージ同士の依存を図にします。
矢印は、使う側から使われる側への向きです。

<table>
  <tr>
    <td align="center" colspan="2"><code>@mg/runs</code> → <code>@mg/runner</code></td>
  </tr>
  <tr>
    <td align="center">↓</td>
    <td align="center">↓</td>
  </tr>
  <tr>
    <td align="center" colspan="2"><code>@mg/harness-loop</code></td>
  </tr>
  <tr>
    <td align="center">↓</td>
    <td align="center">↓</td>
  </tr>
  <tr>
    <td align="center"><code>@mg/tools</code> → <code>@mg/core</code></td>
    <td align="center"><code>@mg/trace</code> → <code>@mg/harness</code> → <code>@mg/core</code></td>
  </tr>
</table>

trace-ui は、走らせる流れの外にいます。
記録を見るときだけ、trace とつながります。

<table>
  <tr>
    <td align="center"><code>@mg/trace-ui</code> → <code>@mg/trace</code></td>
  </tr>
</table>

term は、runs と trace-ui が端末に書くときに使います。

<table>
  <tr>
    <td align="center"><code>@mg/runs</code> → <code>@mg/term</code></td>
    <td align="center"><code>@mg/trace-ui</code> → <code>@mg/term</code></td>
  </tr>
</table>

- runs は、runner を使います。
- 設定を書くには、core と tools も使います。harness-loop と trace も使います。
- runs は、端末に書くために term も使います。
- runner は、core と harness を使います。harness-loop と trace も使います。
- runner は、tools を使いません。
- harness-loop は、4 つを使います。core と tools と harness と trace です。
- trace は、harness と core を使います。
- trace-ui は、trace と term を使います。
- harness と tools は、それぞれ core を使います。
- term は、このリポジトリの他のパッケージに依存しません。
- core は、このリポジトリの他のパッケージに依存しません。

## 開発

どのコマンドも、リポジトリの一番上で実行します。
ビルドや検査は、すべてのパッケージに対して動きます。

```sh
pnpm install       # 依存を入れる
pnpm build         # ビルドする
pnpm typecheck     # 型を調べる
pnpm test          # テストを走らせる
pnpm lint          # コードの問題を探す
pnpm lint:fix      # 直せる問題を直す
pnpm format        # 整形する
pnpm format:check  # 整形の崩れを探す
```

lint は型の情報を使うので、先に build を済ませておきます。
ビルド結果が無いと、型が解決できずに誤った指摘が出ます。

runs は型を調べる対象ですが、ビルドの対象ではありません。
見本の設定を走らせるときは、次のように実行します。

```sh
node --env-file=.env runs/example.ts
```

コミットすると、その直前に整形が走ります。
対象は、コミットに含めるファイルだけです。
整形した結果は、そのままコミットに含まれます。

急いでいて整形を飛ばしたいときは、次の指定を付けます。

```sh
git commit --no-verify
```
