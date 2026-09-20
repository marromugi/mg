# @mg/ui

汎用の画面コンポーネントと、トークンのファイルを持つパッケージです。

## 役割

ui の役割は 2 つです。

- トレースの意味を知らない、汎用のコンポーネントを持ちます。
- 色とフォントと影と角丸の、ただ 1 つの出どころとなるトークンのファイルを持ちます。

コンポーネントは Badge、Button、Card、Heading、Layout、Meta、Quote、Role、
Table、TextField の 10 個です。
それぞれの story と、story のスナップショットの試験も持ちます。

ui は、このリポジトリの他のパッケージに依存しません。
使う側の画面のルートも、ビルド結果の場所も知りません。
要るものは、すべて入力（props）で受け取ります。

## やらないこと

次のことは ui の外に任せます。

- トレースの意味を持つコンポーネントは持ちません。`@mg/trace-ui` の役割です。
- CSS を生成しません。トークンのファイルを配るだけです。使う側が自分のビルドで CSS を作ります。
- CSS のファイルを読みません。`Layout` に埋め込む CSS の中身は、使う側が入力で渡します。

## Layout

`Layout` は、html の全体と配色を切り替えるフォームを描く、ページの外枠です。
次の入力を受け取ります。

| 入力           | 中身                                          |
| -------------- | --------------------------------------------- |
| `title`        | ページのタイトルです。                        |
| `scheme`       | 選ばれている配色です。                        |
| `css`          | `<style>` にそのまま入れる CSS の文字列です。 |
| `schemeAction` | 配色のフォームが送信する送り先です。          |
| `children`     | 本文です。                                    |

配色を選ぶフォームは 3 つ描きます。OS と明と暗の 1 つずつです。
どのフォームも `method="post"` で `schemeAction` に送信し、
`name` が `SCHEME_FIELD` の隠し項目で選んだ値を運びます。

`src/scheme.ts` が、配色まわりの型と値をパッケージのルートから公開します。

| 公開するもの   | 中身                                                 |
| -------------- | ---------------------------------------------------- |
| `Scheme`       | 配色の型です。`"system"`、`"light"`、`"dark"` です。 |
| `SCHEME_FIELD` | 配色のフォームの隠し項目の `name` です。             |
| `parseScheme`  | 任意の値を `Scheme` に直す関数です。                 |

`parseScheme` は、`"light"` と `"dark"` はそのまま返し、それ以外はすべて
`"system"` を返します。

## ディレクトリ

`src` の下の置き場所を表にします。

| 置き場所             | 中身                                                   |
| -------------------- | ------------------------------------------------------ |
| `components/<Name>/` | コンポーネント本体と story                             |
| `scheme.ts`          | 配色の型と、フォームの項目名と、値を読み取る関数       |
| `styles/tokens.css`  | トークンの `@theme` と、コンポーネントを指す `@source` |

コンポーネントのディレクトリの中身は、どれも同じ形です。
`Badge` を例にします。

```
Badge/
├── Badge.tsx
├── Badge.stories.tsx
└── index.ts
```

`TextField` と `Layout` だけは `Name.test.tsx` も持ちます。
アクセシビリティの結びつきや、フォームの送り先といった、
story のスナップショットでは追いにくい決まりを、試験で確かめるからです。

ファイル名とディレクトリ名は、コンポーネント名と同じにします。
各コンポーネントのディレクトリに `index.ts` を置き、外へ出すものだけ並べます。
`src/index.ts` が、10 個のコンポーネントと `scheme.ts` の中身をまとめて出します。

## 見た目の決まり

色とフォントと影と角丸は、`src/styles/tokens.css` の `@theme` に集めます。
コンポーネントは、ここにある名前だけを使います。

コンポーネントは Tailwind の class で書きます。
状態ごとの切り替えは、tailwind-variants で持ちます。

`tokens.css` は `@source` で、自分の `components` を指します。
使う側が `tokens.css` を取り込んだときにも、ui の class が見つかるようにするためです。

CSS の生成は使う側の役割です。
ui はビルドで CSS を作りません。`tokens.css` をそのまま配ります。

lint は oxlint-tailwindcss を使い、`tokens.css` を入り口にして次を止めます。

| ルール                 | 止めるもの              |
| ---------------------- | ----------------------- |
| no-unknown-classes     | tokens.css に無い class |
| no-conflicting-classes | 競合する class          |
| no-arbitrary-value     | 任意の値を使った class  |
| no-hardcoded-colors    | 直接書いた色の値        |

次の 2 つは警告です。

- no-duplicate-classes
- enforce-sort-order

次を実行すると、並び順が直ります。

```sh
pnpm lint:fix
```

これらの決まりの理由は、[issue #100](https://github.com/marromugi/mg/issues/100) にまとめてあります。

## テスト

コンポーネントごとの story を、Node の中で HTML の文字列にします。
その文字列を、保存した文字列と比べます。ブラウザは使いません。
見た目が変わると、テストが落ちます。

比べる前に、両方の文字列から `<style>` の中身を空にします。
生成される CSS は、保存する文字列に含めません。

story は、Storybook での表示と、この比較の入力を兼ねます。
`Badge.stories.tsx` のように、コンポーネントのそばに置きます。

確かめるには、次を実行します。

```sh
pnpm --filter @mg/ui test
```

意図して見た目を変えたときは、まず目で確かめます。
崩れがないと分かったら、保存した文字列を更新します。

```sh
pnpm --filter @mg/ui test -u
```

## Storybook

コンポーネントを 1 つずつ確かめるには、Storybook を動かします。

```sh
pnpm --filter @mg/ui storybook
```

待ち受けるポートは 6007 です。`@mg/trace-ui` の 6006 番と同時に動かせます。
