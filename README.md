# mg

LLM で動くエージェントのハーネスを試すための土台です。

## 目的

ハーネスとは、LLM とツールをつないで仕事をさせる仕組みです。

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

| パッケージ                                            | 役割                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`@mg/core`](packages/core/README.md)                 | プロバイダーの抽象化と、ツールの共通の型                                                     |
| [`@mg/tools`](packages/tools/README.md)               | ハーネスが共通で使う組み込みのツール                                                         |
| [`@mg/workspace`](packages/workspace/README.md)       | 別のマシンにつなぐコネクターの型と、ワークスペースの開閉                                     |
| [`@mg/gate`](packages/gate/README.md)                 | 実行してよいか判定するゲートの型と、LLM と Estimator の実装                                  |
| [`@mg/trigger`](packages/trigger/README.md)           | 走行を始めるべきか判定するトリガーの型とエラーと、判定のスパンを作る部品と、Estimator の実装 |
| [`@mg/harness`](packages/harness/README.md)           | ハーネスが従う共通の入力と出力の型と、サブエージェントのインターフェース                     |
| [`@mg/trace`](packages/trace/README.md)               | トレースの実装と、共通の語彙                                                                 |
| [`@mg/harness-loop`](packages/harness-loop/README.md) | ツールの呼び出しを繰り返すループ型のハーネス                                                 |
| [`@mg/runner`](packages/runner/README.md)             | 設定からハーネスを組み立て、トレースを開いて実行する                                         |
| [`@mg/eval`](packages/eval/README.md)                 | 走行後に記録を読んで判定するインターフェースと、規則と Estimator の実装                      |
| [`@mg/term`](packages/term/README.md)                 | 端末に書く文字の色と印                                                                       |
| [`@mg/dashboard`](dashboard/README.md)                | 日常の利用だけが要る画面と保存と起動                                                         |
| [`runs/`](runs/)                                      | 検証ごとの設定ファイルの置き場所                                                             |

名前を選ぶと、詳しい説明を読めます。

### 新しいコードの置き場所

足したいものごとに、置く場所を表にまとめます。

| 足したいもの                                              | 置く場所                            |
| --------------------------------------------------------- | ----------------------------------- |
| 別のプロバイダーの実装                                    | core                                |
| ツールの型や実行関数                                      | core                                |
| ハーネスが共通で使うツール                                | tools                               |
| 1 つのハーネスだけで使うツール                            | ハーネス（core の型で書く）         |
| サブエージェントのインターフェース                        | harness                             |
| 別のマシンへのコネクター                                  | workspace                           |
| 実行の可否を判定するゲートの実装                          | gate                                |
| 走行を始めるかを判定するトリガーの実装                    | trigger                             |
| ツールの呼び出しの繰り返し                                | harness-loop                        |
| 検証の失敗を LLM にどう返すか                             | harness-loop                        |
| トレースの語彙とエクスポーター                            | trace                               |
| 走行後の判定のインターフェースと、規則と Estimator の実装 | eval                                |
| 端末に出す文字の色と印                                    | term                                |
| 検証ごとの組み立ての設定                                  | runs                                |
| 判定の規則や質問の中身、境目の値                          | runs                                |
| 日常の利用だけが要る画面と保存と起動                      | dashboard                           |
| 実行の方法そのもの（トレースの開閉、複数件、読み込み）    | runner                              |
| 設定からのサブエージェントの組み立て                      | runner                              |
| 形の軸のハーネスの部品（記憶、想起、振り返り、出し方）    | harness-persona（これから作るもの） |

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

eval は、実行の流れの外にいます。
実行が終わったあとで、トレースを読み直すときだけつながります。

<table>
  <tr>
    <td align="center" colspan="2"><code>@mg/runs</code> → <code>@mg/eval</code></td>
  </tr>
  <tr>
    <td align="center">↓</td>
    <td align="center">↓</td>
  </tr>
  <tr>
    <td align="center"><code>@mg/core</code></td>
    <td align="center"><code>@mg/trace</code> → <code>@mg/harness</code> → <code>@mg/core</code></td>
  </tr>
</table>

term は、runs が端末に書くときに使います。

<table>
  <tr>
    <td align="center"><code>@mg/runs</code> → <code>@mg/term</code></td>
  </tr>
</table>

gate は、実行の流れの中にいます。
runner と harness-loop が、判定を挟むために使います。

<table>
  <tr>
    <td align="center"><code>@mg/runner</code> → <code>@mg/gate</code></td>
  </tr>
  <tr>
    <td align="center"><code>@mg/harness-loop</code> → <code>@mg/gate</code></td>
  </tr>
  <tr>
    <td align="center">↓</td>
  </tr>
  <tr>
    <td align="center"><code>@mg/gate</code> → <code>@mg/trace</code> → <code>@mg/harness</code> → <code>@mg/core</code></td>
  </tr>
</table>

workspace は、core だけを使います。

<table>
  <tr>
    <td align="center"><code>@mg/workspace</code> → <code>@mg/core</code></td>
  </tr>
</table>

runner は、走る前後で作業場を開いて閉じるために workspace を使います。

<table>
  <tr>
    <td align="center"><code>@mg/runner</code> → <code>@mg/workspace</code> → <code>@mg/core</code></td>
  </tr>
</table>

- runs は、runner を使います。
- 設定を書くには、core と tools も使います。harness-loop と trace と gate も使います。
- runs は、端末に書くために term も使います。
- runs は、eval も使います。
- runner は、core と harness を使います。harness-loop と trace と gate と workspace も使います。
- runner は、tools を使いません。
- runner は、eval を使いません。
- harness-loop は、5 つを使います。core と tools と harness と trace と gate です。
- trace は、harness と core を使います。
- eval は、core と trace を使います。
- harness と tools は、それぞれ core を使います。
- gate は、core と harness と trace を使います。
- workspace は、core を使います。
- term は、このリポジトリの他のパッケージに依存しません。
- core は、このリポジトリの他のパッケージに依存しません。
- runs と dashboard は、使う側です。互いを使いません。
- dashboard は、いまは何も使いません。
- packages のどのパッケージも、dashboard を使いません。

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
見本の設定は、次のように実行します。

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
